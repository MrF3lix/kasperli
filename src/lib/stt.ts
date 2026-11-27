import "server-only"
import type { TranscribeJob, TranscriptFormat } from "@/lib/transcribe"
import type { SttModel } from "@/lib/transcription-client"
import type { Language } from "@/lib/tts"

// The STT gateway (stt-api, see its docs/client-integration.md) transcribes recordings. It has no
// authentication, so only the server talks to it: the browser goes through /api/transcriptions,
// which only signed-in users can use.

// Swiss German speech to Standard German text: the model used unless another one is chosen
// (the Anonymize page needs exactly this), with its default language "gsw"
export const STT_MODEL = "whisper-swiss-german"

// what the browser needs of a job: GET /jobs/{id} of the STT gateway has more
export type Transcription = {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  text: string | null
  error: string | null
  queue_position: number | null
  eta_seconds: number | null
}

type SttFile = { status: Transcription["status"]; text?: string; error?: string }
type SttJob = { id: string; status: Transcription["status"]; files: SttFile[]; queue_position: number | null; eta_seconds: number | null }

export class SttError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function sttUrl(path: string): URL {
  const base = process.env.STT_API_URL
  if (!base) {
    throw new SttError("Automatic transcription is not set up.", 503)
  }
  return new URL(path, base)
}

async function request<T = SttJob>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<T> {
  const response = await send(path, init, timeoutMs)
  return response.json()
}

// the gateway's response if it is a success, otherwise an SttError with a message for the user
async function send(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<Response> {
  let response: Response
  try {
    response = await fetch(sttUrl(path), { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    if (e instanceof SttError) throw e
    console.error(`STT request ${init?.method ?? "GET"} ${path} failed`, e)
    throw new SttError("The transcription service is not reachable.", 502)
  }
  if (!response.ok) {
    const { detail } = await response.json().catch(() => ({ detail: null }))
    if (response.status === 404) throw new SttError("The transcription has expired.", 404)
    if (response.status === 429) throw new SttError("The transcription service is busy. Try again later.", 429)
    console.error(`STT request ${path} answered ${response.status}`, detail)
    if (response.status === 409) throw new SttError(typeof detail === "string" ? detail : "The transcript is not ready.", 409)
    throw new SttError(typeof detail === "string" ? `Transcription failed: ${detail}` : "Transcription failed.", response.status === 422 ? 422 : 502)
  }
  return response
}

// a job has one file: its status, text and error are the transcription's
function toTranscription(job: SttJob): Transcription {
  const file = job.files[0]
  return {
    id: job.id,
    status: file?.status ?? job.status,
    text: file?.status === "completed" ? (file.text ?? "").trim() : null,
    error: file?.error ?? null,
    queue_position: job.queue_position,
    eta_seconds: job.eta_seconds,
  }
}

/**
 * Starts transcribing a recording; it is done in the background, see getTranscription. Without a
 * language the model uses its default one, or detects it.
 */
export async function startTranscription(audio: File, model = STT_MODEL, language: string | null = null): Promise<Transcription> {
  const body = new FormData()
  body.append("audio", audio, audio.name || "recording.wav")
  body.append("model", model)
  if (language) body.append("language", language)
  return toTranscription(await request("/jobs", { method: "POST", body }))
}

export async function getTranscription(id: string): Promise<Transcription> {
  return toTranscription(await request(`/jobs/${id}`))
}

/** Stops a transcription that hasn't started, e.g. when the recording is discarded. */
export async function cancelTranscription(id: string): Promise<void> {
  await request(`/jobs/${id}`, { method: "DELETE" })
}

// --- jobs of the Transcribe page: several files, options and transcript formats ---

/**
 * Submits a job as it came from the browser: the multipart body (audio, model, language,
 * timestamps) is streamed through unchanged, so long recordings aren't held in memory here.
 * The gateway checks the fields.
 */
export async function submitTranscribeJob(body: ReadableStream<Uint8Array>, contentType: string): Promise<TranscribeJob> {
  // uploading up to 20 long files can take a while
  return request<TranscribeJob>("/jobs", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    duplex: "half",
  } as RequestInit, 15 * 60_000)
}

export async function getTranscribeJob(id: string): Promise<TranscribeJob> {
  return request<TranscribeJob>(`/jobs/${encodeURIComponent(id)}`)
}

/** Cancels the files that haven't started; running ones still finish. */
export async function cancelTranscribeJob(id: string): Promise<TranscribeJob> {
  return request<TranscribeJob>(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** A finished file's transcript as the gateway sends it (json, txt, srt or vtt). */
export async function getTranscript(id: string, index: number, format: TranscriptFormat): Promise<Response> {
  return send(`/jobs/${encodeURIComponent(id)}/transcripts/${index}.${format}`)
}

/** The STT gateway's models with their languages, for choosing one; null if they can't be read. */
export async function getSttModels(): Promise<SttModel[] | null> {
  try {
    const response = await fetch(sttUrl("/models"), { cache: "no-store", signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const models: unknown = await response.json()
    if (!Array.isArray(models)) return null
    return models.filter((m) => typeof m?.id === "string" && Array.isArray(m.languages)).map((m) => ({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      languages: m.languages.filter((l: unknown) => typeof (l as Language)?.code === "string"),
      default_language: typeof m.default_language === "string" ? m.default_language : null,
      timestamps: m.timestamps === true,
      workers: typeof m.workers === "number" ? m.workers : 0,
    }))
  } catch (e) {
    console.warn("loading the transcription models failed", e instanceof Error ? e.message : e)
    return null
  }
}

/** The response of a route handler for an error of these functions. */
export function sttErrorResponse(e: unknown): Response {
  if (e instanceof SttError) {
    return Response.json({ detail: e.message }, { status: e.status })
  }
  console.error("transcription failed", e)
  return Response.json({ detail: "Transcription failed." }, { status: 500 })
}

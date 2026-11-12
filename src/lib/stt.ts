import "server-only"

// The STT gateway (stt-api, see its docs/client-integration.md) transcribes recordings. It has no
// authentication, so only the server talks to it: the browser goes through /api/transcriptions,
// which only signed-in users can use.

// Swiss German speech to Standard German text. The dialect isn't sent: the model has only "gsw",
// which it uses by default (mapping the TTS dialects to STT languages is still open)
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

async function request(path: string, init?: RequestInit): Promise<SttJob> {
  let response: Response
  try {
    response = await fetch(sttUrl(path), { ...init, cache: "no-store", signal: AbortSignal.timeout(60_000) })
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
    throw new SttError(typeof detail === "string" ? `Transcription failed: ${detail}` : "Transcription failed.", response.status === 422 ? 422 : 502)
  }
  return response.json()
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

/** Starts transcribing a recording; it is done in the background, see getTranscription. */
export async function startTranscription(audio: File): Promise<Transcription> {
  const body = new FormData()
  body.append("audio", audio, audio.name || "recording.wav")
  body.append("model", STT_MODEL)
  return toTranscription(await request("/jobs", { method: "POST", body }))
}

export async function getTranscription(id: string): Promise<Transcription> {
  return toTranscription(await request(`/jobs/${id}`))
}

/** Stops a transcription that hasn't started, e.g. when the recording is discarded. */
export async function cancelTranscription(id: string): Promise<void> {
  await request(`/jobs/${id}`, { method: "DELETE" })
}

/** The response of a route handler for an error of these functions. */
export function sttErrorResponse(e: unknown): Response {
  if (e instanceof SttError) {
    return Response.json({ detail: e.message }, { status: e.status })
  }
  console.error("transcription failed", e)
  return Response.json({ detail: "Transcription failed." }, { status: 500 })
}

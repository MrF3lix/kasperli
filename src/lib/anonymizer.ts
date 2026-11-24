import "server-only"
import { getModels } from "@/lib/gateway"
import type { AnonymizeJob, AnonymizeStatus, AnonymizerModel } from "@/lib/anonymize"
import type { Language } from "@/lib/tts"

// The anonymizer gateway (globi, see its README) has no authentication, so only the server talks
// to it: the browser goes through /api/anonymize, which only signed-in users can use.

// the TTS model whose dialects the anonymizer shares; used for names and while its /models fails
const XTTS_MODEL = "xtts"

export class AnonymizerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function anonymizerUrl(path: string): URL {
  const base = process.env.ANONYMIZER_URL
  if (!base) {
    throw new AnonymizerError("The anonymizer is not set up.", 503)
  }
  return new URL(path, base)
}

/** A request to the anonymizer; gateway errors become AnonymizerErrors with a message for the user. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(anonymizerUrl(path), { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(60_000) })
  } catch (e) {
    if (e instanceof AnonymizerError) throw e
    console.error(`anonymizer request ${init?.method ?? "GET"} ${path} failed`, e)
    throw new AnonymizerError("The anonymizer is not reachable. Try again later.", 502)
  }
  if (response.ok) return response
  const { detail } = await response.json().catch(() => ({ detail: null }))
  if (response.status === 404) throw new AnonymizerError("The job has expired.", 404)
  if (response.status === 409) throw new AnonymizerError(typeof detail === "string" ? detail : "The job is not finished.", 409)
  if (response.status === 429) throw new AnonymizerError("The queue is full right now. Wait a moment and try again.", 429)
  if (response.status === 422) {
    const message = typeof detail === "string" ? detail
      : Array.isArray(detail) ? detail.map((d) => `${d.loc?.at(-1) ?? "input"}: ${d.msg}`).join("; ")
      : "The anonymizer rejected the input."
    throw new AnonymizerError(message, 422)
  }
  console.error(`anonymizer request ${path} answered ${response.status}`, detail)
  throw new AnonymizerError("The anonymizer failed. Try again later.", 502)
}

// the gateway keeps jobs as Redis hashes, so every value arrives as a string
type RawJob = Record<string, string>

function toJob(raw: RawJob): AnonymizeJob {
  return {
    id: raw.id,
    status: raw.status as AnonymizeStatus,
    language: raw.language,
    text: raw.text ?? "",
    transcript: raw.transcript || null,
    error: raw.error || null,
    seed: raw.seed !== undefined && raw.seed !== "" && Number.isFinite(Number(raw.seed)) ? Number(raw.seed) : null,
    created_at: Number(raw.created_at) || 0,
  }
}

/** Submits a job: `target` is re-spoken in the voice of `reference`; without a seed it picks one. */
export async function submitAnonymization(
  target: Blob, reference: Blob, model: string, language: string, text: string, seed: number | null,
): Promise<AnonymizeJob> {
  const body = new FormData()
  body.append("target_wav", target, "target.wav")
  body.append("reference_wav", reference, "reference.wav")
  if (model) body.append("model", model)
  body.append("language", language)
  if (text) body.append("text", text)
  if (seed !== null) body.append("seed", String(seed))
  const response = await request("/jobs", { method: "POST", body })
  return toJob(await response.json())
}

export async function getAnonymization(id: string): Promise<AnonymizeJob> {
  return toJob(await (await request(`/jobs/${id}`)).json())
}

/** Deletes a job and its audio; a queued job is skipped by the workers. */
export async function deleteAnonymization(id: string): Promise<void> {
  await request(`/jobs/${id}`, { method: "DELETE" })
}

/** The anonymized recording of a completed job. */
export async function anonymizationResult(id: string): Promise<Response> {
  return request(`/jobs/${id}/result.wav`)
}

/**
 * The anonymizer's models with their dialects, from its /models (the TTS gateway's format).
 * Dialects without names are named after the XTTS model's; while the list can't be read, a model
 * with the XTTS model's dialects stands in, so the page still works.
 */
export async function getAnonymizerModels(token: string): Promise<AnonymizerModel[] | { error: string }> {
  const tts = await getModels(token)
  const xtts = "error" in tts ? [] : (tts.find((m) => m.id === XTTS_MODEL)?.languages ?? [])
  const names = new Map(xtts.map((l) => [l.code, l.name]))

  try {
    const response = await request("/models", { signal: AbortSignal.timeout(10_000) })
    const models = parseModels(await response.json())
      .map((m) => ({ ...m, languages: m.languages.map((l) => ({ code: l.code, name: l.name || names.get(l.code) || l.code })) }))
      .filter((m) => m.languages.length)
    if (models.length) return models
  } catch (e) {
    console.warn("loading the anonymizer's models failed, using the XTTS model's dialects", e instanceof AnonymizerError ? e.message : e)
  }
  return xtts.length
    ? [{ id: "", name: "Anonymizer", languages: xtts, workers: null }]
    : { error: "The list of dialects could not be loaded." }
}

function parseModels(data: unknown): AnonymizerModel[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((m): AnonymizerModel[] => {
    if (typeof m?.id !== "string" || !Array.isArray(m.languages)) return []
    const languages: Language[] = m.languages.flatMap((l: unknown) =>
      typeof l === "string" ? [{ code: l, name: "" }]
        : l && typeof (l as Language).code === "string" ? [{ code: (l as Language).code, name: typeof (l as Language).name === "string" ? (l as Language).name : "" }]
        : [])
    return [{ id: m.id, name: typeof m.name === "string" ? m.name : m.id, languages, workers: typeof m.workers === "number" ? m.workers : null }]
  })
}

/** The response of a route handler for an error of these functions. */
export function anonymizerErrorResponse(e: unknown): Response {
  if (e instanceof AnonymizerError) {
    return Response.json({ detail: e.message }, { status: e.status })
  }
  console.error("anonymization failed", e)
  return Response.json({ detail: "Anonymization failed." }, { status: 500 })
}

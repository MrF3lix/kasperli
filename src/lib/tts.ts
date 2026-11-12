// Types and helpers for the TTS gateway's API (see tts-api/docs/client-integration.md).
// Shared by server and client code.

export type Language = { code: string; name: string }

export type ModelInfo = {
  id: string
  name: string
  backend: string
  // whether the model uses a transcript of the reference recording
  ref_text: "ignored" | "optional" | "required"
  languages: Language[]
  workers: number
}

// GET /health: live workers and queued samples per registered model id
export type Health = {
  status: string
  workers: Record<string, number>
  // samples waiting for a worker; missing on gateways older than this field
  queued?: Record<string, number>
}

export type SampleStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type Sample = {
  index: number
  status: SampleStatus
  seed: number
  url?: string
  duration_s?: number
  error?: string
}

export type Job = {
  id: string
  status: SampleStatus
  model: string
  language: string
  text: string
  ref_text: string | null
  created_at: number
  samples_total: number
  samples_completed: number
  samples: Sample[]
  queue_position: number | null
  eta_seconds: number | null
}

// mirror the gateway's limits (configs/api.yaml) so the form can say so before submitting
export const MAX_TEXT_CHARS = 1000
export const MAX_REF_TEXT_CHARS = 1000
export const MAX_SPEAKER_SECONDS = 60
export const MAX_SAMPLES = 8
export const DEFAULT_SAMPLES = 1

// Samples users record themselves on the Record page are stored like generated ones, with this
// model id, the dialect they choose and the transcript they type
export const RECORDING_MODEL = "recording"
export const RECORDING_MODEL_NAME = "Recording"
// recordings are uploaded in one request, which the proxy limits to 10 MB
export const MAX_RECORDING_SECONDS = 90
export const MAX_RECORDING_BYTES = 9.5 * 1024 * 1024
export const MAX_TRANSCRIPT_CHARS = 5000

/** The dialects of all models, each once, by name; recordings can be in any of them. */
export function allDialects(models: ModelInfo[]): Language[] {
  const byCode = new Map<string, Language>()
  for (const model of models) {
    for (const language of model.languages) {
      if (!byCode.has(language.code)) byCode.set(language.code, language)
    }
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Display names by model id and by "model id/dialect code", including recordings; ids and codes
 * are shown for models the gateway doesn't list (or while it is unreachable).
 */
export function displayNames(models: ModelInfo[]): { modelNames: Record<string, string>; languageNames: Record<string, string> } {
  return {
    modelNames: { [RECORDING_MODEL]: RECORDING_MODEL_NAME, ...Object.fromEntries(models.map((m) => [m.id, m.name])) },
    languageNames: Object.fromEntries([
      ...allDialects(models).map((l) => [`${RECORDING_MODEL}/${l.code}`, l.name]),
      ...models.flatMap((m) => m.languages.map((l) => [`${m.id}/${l.code}`, l.name])),
    ]),
  }
}

const FINISHED = new Set<SampleStatus>(["completed", "failed", "cancelled"])

// a cancelled job can still have running samples, so look at the samples, not the job status
export function isFinished(job: Job): boolean {
  return job.samples.every((s) => FINISHED.has(s.status))
}

/** The message of a gateway error response: {"detail": "..."} or FastAPI's validation list. */
export async function errorMessage(response: Response): Promise<string> {
  try {
    const { detail } = await response.json()
    if (typeof detail === "string") {
      return detail
    }
    if (Array.isArray(detail)) {
      return detail.map((d) => `${d.loc?.at(-1) ?? "input"}: ${d.msg}`).join("; ")
    }
  } catch {
    // not JSON
  }
  return `Request failed (${response.status})`
}

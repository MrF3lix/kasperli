// Types and limits of the anonymizer gateway (globi), shared by server and client code.
// An anonymization job re-speaks the words of a target recording in the voice of a reference
// (donor) recording, in the chosen dialect.

import type { Language } from "@/lib/tts"

// a model of the anonymizer (GET /models); workers is null where unknown. id "" stands for the
// anonymizer's only model while its list can't be read
export type AnonymizerModel = { id: string; name: string; languages: Language[]; workers: number | null }

export type AnonymizeStatus = "queued" | "running" | "completed" | "failed"

export type AnonymizeJob = {
  id: string
  status: AnonymizeStatus
  language: string
  // the Standard German transcript given with the job ("" if none was given)
  text: string
  // the transcript the worker used: the given one, or Whisper's
  transcript: string | null
  error: string | null
  // null for jobs from before the anonymizer took seeds
  seed: number | null
  created_at: number
}

// mirror the gateway's limits (globi configs/api.yaml) so the form can say so before submitting
export const MAX_TARGET_SECONDS = 27
export const MAX_REFERENCE_SECONDS = 60
export const MAX_ANONYMIZE_TEXT_CHARS = 1000
// variants are separate jobs of the same input, each one a different take
export const MAX_ANONYMIZE_VARIANTS = 8
// seeds the anonymizer accepts: 0 to 2^32 - 1; variant i uses seed + i, as on the TTS gateway
export const MAX_ANONYMIZE_SEED = 2 ** 32 - 1

const FINISHED = new Set<AnonymizeStatus>(["completed", "failed"])

export function isAnonymizeFinished(job: AnonymizeJob): boolean {
  return FINISHED.has(job.status)
}

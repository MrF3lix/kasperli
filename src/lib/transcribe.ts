// Transcription jobs of the Transcribe page: one or more audio files transcribed with one model,
// through /api/stt/jobs (which forwards to the STT gateway, see stt-api's
// docs/client-integration.md). Shared by the server and client components.

export type TranscribeStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

// how words are grouped into segments (and SRT / VTT cues); /models gives each model's defaults
export type SegmentOptions = {
  max_chars: number
  max_seconds: number
  pause_seconds: number
  min_seconds: number
  split_on_comma: boolean
}

// what a job asked for beyond model, language and timestamps (only what was set)
export type TranscribeOptions = {
  diarization?: string
  speakers?: { num_speakers?: number; min_speakers?: number; max_speakers?: number }
  segments?: Partial<SegmentOptions>
  piece_seconds?: number
}

// the ranges the STT gateway accepts
export const SEGMENT_LIMITS: Record<Exclude<keyof SegmentOptions, "split_on_comma">, { min: number; max: number; step: number }> = {
  max_chars: { min: 10, max: 500, step: 1 },
  max_seconds: { min: 1, max: 30, step: 0.5 },
  pause_seconds: { min: 0.1, max: 5, step: 0.1 },
  min_seconds: { min: 0, max: 10, step: 0.1 },
}
export const PIECE_SECONDS = { min: 5, max: 28 }
export const MAX_SPEAKERS = 20

export type TranscribeFile = {
  index: number
  filename: string
  status: TranscribeStatus
  audio_seconds: number
  text?: string
  // the language used: detected, if none was requested
  language?: string
  processing_seconds?: number
  error?: string
  // e.g. speakers could not be detected; the transcript is there without them
  warning?: string
  // while running: fraction done (0..1), updated about once a second; missing on gateways
  // older than this field
  progress?: number
}

/** How much of a job is done (0..1): finished files count fully, running ones by their progress. */
export function jobProgress(job: TranscribeJob): number {
  if (!job.files.length) return 0
  const done = job.files.reduce((sum, f) => sum + (isTranscribeFinished(f.status) ? 1 : f.status === "running" ? (f.progress ?? 0) : 0), 0)
  return done / job.files.length
}

// GET /jobs/{id} of the STT gateway
export type TranscribeJob = {
  id: string
  status: TranscribeStatus
  model: string
  // requested; null: detected per file
  language: string | null
  timestamps: boolean
  // missing on gateways older than this field
  options?: TranscribeOptions
  created_at: number
  files_total: number
  files_completed: number
  files: TranscribeFile[]
  queue_position: number | null
  eta_seconds: number | null
}

// GET /jobs/{id}/transcripts/{i}.json
// speaker: "SPEAKER_1", ... when the job asked for speaker diarization
export type TranscriptSegment = { start: number; end: number; text: string; speaker?: string }
export type TranscriptJson = {
  text: string
  language: string
  audio_seconds: number
  segments: TranscriptSegment[] | null
  speakers?: string[] | null
}

/** SPEAKER_2 -> Speaker 2 */
export function speakerLabel(speaker: string): string {
  return speaker.startsWith("SPEAKER_") ? `Speaker ${speaker.slice(8)}` : speaker
}

export type TranscriptFormat = "txt" | "json" | "srt" | "vtt"
export const TRANSCRIPT_FORMATS: TranscriptFormat[] = ["txt", "json", "srt", "vtt"]

// limits of the STT gateway
export const MAX_TRANSCRIBE_FILES = 20
export const MAX_TRANSCRIBE_SECONDS = 30 * 60
// one upload of up to 20 files; 30 min of 48 kHz stereo WAV are about 330 MB, so long files
// should be compressed (FLAC, MP3, OGG)
export const MAX_TRANSCRIBE_BYTES = 1024 * 1024 * 1024

export const JOB_ID = /^[\w-]{1,100}$/

export function isTranscribeFinished(status: TranscribeStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

export function transcriptUrl(jobId: string, index: number, format: TranscriptFormat, download?: string): string {
  const url = `/api/stt/jobs/${encodeURIComponent(jobId)}/transcripts/${index}.${format}`
  return download ? `${url}?download=${encodeURIComponent(download)}` : url
}

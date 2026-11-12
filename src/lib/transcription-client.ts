// Automatic transcription of recordings from the browser, through /api/transcriptions (which
// forwards to the STT gateway). Shared by client components.

import { errorMessage } from "@/lib/tts"

export type TranscriptionState = {
  id: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  text: string | null
  error: string | null
  queue_position: number | null
  eta_seconds: number | null
}

const POLL_MS = 2000

/** Starts transcribing a recording; throws with a message for the user if it can't. */
export async function startTranscription(audio: File, signal?: AbortSignal): Promise<TranscriptionState> {
  const body = new FormData()
  body.append("audio", audio)
  const response = await fetch("/api/transcriptions", { method: "POST", body, signal })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json()
}

/**
 * Polls a transcription until it is finished and returns its text; `onUpdate` gets every state
 * (queue position, running). Throws with a message if it fails, or an AbortError when aborted.
 */
export async function waitForTranscription(id: string, signal: AbortSignal, onUpdate?: (state: TranscriptionState) => void): Promise<string> {
  for (;;) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_MS)
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
    const response = await fetch(`/api/transcriptions/${id}`, { signal, cache: "no-store" })
    // gateway hiccups: try again on the next round
    if (response.status >= 500) continue
    if (!response.ok) throw new Error(await errorMessage(response))
    const state: TranscriptionState = await response.json()
    onUpdate?.(state)
    if (state.status === "completed") return state.text ?? ""
    if (state.status === "failed") throw new Error(state.error ? `Automatic transcription failed: ${state.error}` : "Automatic transcription failed.")
    if (state.status === "cancelled") throw new Error("Automatic transcription was cancelled.")
  }
}

/** Stops a transcription that is no longer needed; failures don't matter. */
export function cancelTranscription(id: string) {
  void fetch(`/api/transcriptions/${id}`, { method: "DELETE" }).catch(() => {})
}

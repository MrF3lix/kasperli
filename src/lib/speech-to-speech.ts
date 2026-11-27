import "server-only"

// The speech-to-speech service (Hugging Face speech-to-speech: VAD → Whisper → LLM → XTTS) speaks
// the OpenAI Realtime protocol. The app uses its WebRTC transport: the browser's SDP offer is
// forwarded here, so the browser never talks to the service's HTTP API itself (it has no login),
// while audio and events then flow over WebRTC between the browser and the service.

export class SpeechToSpeechError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const TIMEOUT_MS = 20_000
// an SDP offer is a few kB
export const MAX_SDP_BYTES = 64 * 1024

function baseUrl(): string {
  const base = process.env.SPEECH_TO_SPEECH_URL
  if (!base) throw new SpeechToSpeechError("Speech-to-speech is not set up for this app.", 503)
  return base
}

/** Starts a call: the SDP answer, and the call's id for hanging up (if the service sent one). */
export async function startCall(offer: string): Promise<{ answer: string; callId: string | null }> {
  let response: Response
  try {
    response = await fetch(new URL("/v1/realtime/calls", baseUrl()), {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: offer,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof SpeechToSpeechError) throw e
    console.error("speech-to-speech call failed", e)
    throw new SpeechToSpeechError("The speech-to-speech service is not reachable.", 502)
  }
  if (response.status === 503) {
    throw new SpeechToSpeechError(
      "The service is busy with another conversation (another tab or user, or the previous one is still closing). Try again in a few seconds.",
      503,
    )
  }
  if (!response.ok) {
    console.error("speech-to-speech call refused", response.status, await response.text().catch(() => ""))
    throw new SpeechToSpeechError(`The speech-to-speech service answered with ${response.status}.`, 502)
  }
  // Location: /v1/realtime/calls/{id}
  const location = response.headers.get("location")
  const callId = location?.split("/").filter(Boolean).pop() ?? null
  return { answer: await response.text(), callId: callId && /^[\w-]{1,200}$/.test(callId) ? callId : null }
}

/** Ends a call; the service also ends it when the connection closes, so failures are only logged. */
export async function hangUp(callId: string): Promise<void> {
  try {
    await fetch(new URL(`/v1/realtime/calls/${encodeURIComponent(callId)}`, baseUrl()), {
      method: "DELETE",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    console.error("speech-to-speech hang-up failed", e)
  }
}

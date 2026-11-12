import { verifiedToken } from "@/lib/gateway"
import { startTranscription, sttErrorResponse } from "@/lib/stt"
import { MAX_RECORDING_BYTES } from "@/lib/tts"

// starts the automatic transcription of a recording (multipart field "audio", a WAV) and
// returns the transcription to poll at /api/transcriptions/{id}
export async function POST(request: Request) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const audio = (await request.formData().catch(() => null))?.get("audio")
  if (!(audio instanceof File) || !audio.size) {
    return Response.json({ detail: "Record something first." }, { status: 400 })
  }
  if (audio.size > MAX_RECORDING_BYTES) {
    return Response.json({ detail: "The recording is too long." }, { status: 413 })
  }
  try {
    return Response.json(await startTranscription(audio), { status: 202 })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

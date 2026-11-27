import { verifiedToken } from "@/lib/gateway"
import { sttErrorResponse, submitTranscribeJob } from "@/lib/stt"
import { MAX_TRANSCRIBE_BYTES } from "@/lib/transcribe"

// starts a transcription job of the Transcribe page: multipart with one or more "audio" files and
// optional "model", "language" and "timestamps" (see the STT gateway's POST /jobs)
export async function POST(request: Request) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const contentType = request.headers.get("content-type")
  if (!contentType?.startsWith("multipart/form-data") || !request.body) {
    return Response.json({ detail: "Choose one or more audio files." }, { status: 400 })
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_TRANSCRIBE_BYTES) {
    return Response.json({ detail: "The files are too large together. Compress them (e.g. FLAC or MP3) or send fewer at once." }, { status: 413 })
  }
  try {
    return Response.json(await submitTranscribeJob(request.body, contentType), { status: 202 })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

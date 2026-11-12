import { revalidatePath } from "next/cache"
import { getModels, verifiedToken } from "@/lib/gateway"
import { KeepError, saveRecording } from "@/lib/samples"
import { allDialects, MAX_RECORDING_BYTES } from "@/lib/tts"

// saves a recording made on the Record page: multipart form with "audio" (16-bit mono WAV),
// "language" (a dialect code of one of the models) and "text" (the transcript, may be empty).
// A route handler instead of a server action, which would only accept 1 MB.
export async function POST(request: Request) {
  const token = await verifiedToken()
  if (!token) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const form = await request.formData().catch(() => null)
  const audio = form?.get("audio")
  const language = form?.get("language")
  const text = form?.get("text") ?? ""
  if (!(audio instanceof File) || typeof language !== "string" || typeof text !== "string") {
    return Response.json({ detail: "Record something first." }, { status: 400 })
  }
  if (audio.size > MAX_RECORDING_BYTES) {
    return Response.json({ detail: "The recording is too long." }, { status: 413 })
  }

  const models = await getModels(token)
  if ("error" in models) {
    return Response.json({ detail: "The list of dialects is unavailable. Try again later." }, { status: 503 })
  }
  if (!allDialects(models).some((l) => l.code === language)) {
    return Response.json({ detail: "Choose a dialect." }, { status: 400 })
  }

  try {
    const id = await saveRecording(audio, language, text)
    revalidatePath("/saved")
    return Response.json({ id }, { status: 201 })
  } catch (e) {
    if (e instanceof KeepError) {
      return Response.json({ detail: e.message }, { status: e.status })
    }
    console.error("saving a recording failed", e)
    return Response.json({ detail: "Saving failed. Try again later." }, { status: 500 })
  }
}

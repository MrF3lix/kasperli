import { tokenUserId } from "@/lib/auth-token"
import { anonymizerErrorResponse, deleteAnonymization, submitAnonymization } from "@/lib/anonymizer"
import { verifiedToken } from "@/lib/gateway"
import { findOrCreateSpeaker, speakerAudio } from "@/lib/speakers"
import { MAX_ANONYMIZE_SEED, MAX_ANONYMIZE_TEXT_CHARS, MAX_ANONYMIZE_VARIANTS, type AnonymizeJob } from "@/lib/anonymize"

/**
 * Submits an anonymization job: target_wav is re-spoken in the voice of the reference, which is
 * either a saved speaker (speaker_id) or a new recording (reference_wav). A new reference is
 * saved as a speaker once the anonymizer accepts the job; the response carries the speaker's id
 * in X-Speaker-Id. Optional: text, the Standard German transcript of the target, and
 * num_samples, the number of variants: one job each, all returned as {"jobs": [...]}, and seed:
 * variant i uses seed + i, as on the TTS gateway; without it the anonymizer picks one per job.
 */
export async function POST(request: Request) {
  const token = await verifiedToken()
  if (!token) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const form = await request.formData().catch(() => null)
  if (!form) {
    return Response.json({ detail: "Expected a multipart form" }, { status: 400 })
  }

  const target = form.get("target_wav")
  if (!(target instanceof File) || !target.size) {
    return Response.json({ detail: "Add the recording to anonymize first." }, { status: 400 })
  }
  const language = form.get("language")
  if (typeof language !== "string" || !language) {
    return Response.json({ detail: "Choose a dialect." }, { status: 400 })
  }
  const modelField = form.get("model")
  const model = typeof modelField === "string" ? modelField : ""
  const text = typeof form.get("text") === "string" ? (form.get("text") as string).trim() : ""
  if (text.length > MAX_ANONYMIZE_TEXT_CHARS) {
    return Response.json({ detail: `The transcript is longer than ${MAX_ANONYMIZE_TEXT_CHARS} characters.` }, { status: 400 })
  }

  const variants = Number(form.get("num_samples") ?? 1)
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_ANONYMIZE_VARIANTS) {
    return Response.json({ detail: `Choose between 1 and ${MAX_ANONYMIZE_VARIANTS} variants.` }, { status: 400 })
  }

  const seedField = form.get("seed")
  const seed = typeof seedField === "string" && seedField.trim() ? Number(seedField) : null
  if (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed + variants - 1 > MAX_ANONYMIZE_SEED)) {
    return Response.json({ detail: `The seed must be a whole number from 0 to ${MAX_ANONYMIZE_SEED - variants + 1}.` }, { status: 400 })
  }

  const speakerId = form.get("speaker_id")
  let reference: Blob
  if (typeof speakerId === "string" && speakerId) {
    const audio = await speakerAudio(token, speakerId)
    if (!audio) {
      return Response.json({ detail: "This speaker no longer exists." }, { status: 404 })
    }
    reference = await audio.blob()
  } else {
    const upload = form.get("reference_wav")
    if (!(upload instanceof File) || !upload.size) {
      return Response.json({ detail: "Add a reference recording of the voice first." }, { status: 400 })
    }
    reference = upload
  }

  // all variants or none: if one is refused (e.g. the queue is full), the others are deleted
  const submitted = await Promise.allSettled(
    Array.from({ length: variants }, (_, i) => submitAnonymization(target, reference, model, language, text, seed === null ? null : seed + i)),
  )
  const jobs = submitted.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<AnonymizeJob>).value)
  const failure = submitted.find((r) => r.status === "rejected")
  if (failure) {
    await Promise.allSettled(jobs.map((job) => deleteAnonymization(job.id)))
    return anonymizerErrorResponse(failure.reason)
  }

  const headers = new Headers()
  if (typeof speakerId === "string" && speakerId) {
    headers.set("x-speaker-id", speakerId)
  } else if (reference instanceof File) {
    try {
      const speaker = await findOrCreateSpeaker(token, tokenUserId(token)!, reference, reference.name.replace(/\.wav$/i, ""))
      headers.set("x-speaker-id", speaker.id)
    } catch (e) {
      // the job is running anyway; the speaker just isn't saved
      console.error("saving the speaker failed", e)
    }
  }
  return Response.json({ jobs }, { status: 202, headers })
}

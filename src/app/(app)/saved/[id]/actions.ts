"use server"

import { revalidatePath } from "next/cache"
import { ClientResponseError } from "pocketbase"
import { type ErrorCounts, ERROR_KEYS, MAX_ERROR_COUNT, normalizeErrors } from "@/lib/annotations"
import { requireToken } from "@/lib/auth"
import { isRecordId } from "@/lib/files"
import { getModels } from "@/lib/gateway"
import { createPocketBase } from "@/lib/pocketbase"
import { allDialects, MAX_TRANSCRIPT_CHARS } from "@/lib/tts"

// access rules only allow changes to the user's own samples; the Saved page shows annotations,
// so its cached copy in the browser is invalidated
async function updateSample<T>(id: string, data: Record<string, unknown>, fields: string, read: (record: Record<string, unknown>) => T): Promise<T | { error: string }> {
  if (!isRecordId(id)) {
    return { error: "Unknown sample." }
  }
  try {
    const record = await createPocketBase(await requireToken()).collection("samples").update(id, data, { fields })
    revalidatePath("/saved")
    return read(record)
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return { error: "This sample no longer exists." }
    }
    console.error("saving an annotation failed", e)
    return { error: "Saving failed. Try again later." }
  }
}

export async function saveErrors(id: string, errors: ErrorCounts): Promise<{ errors: ErrorCounts } | { error: string }> {
  const valid = errors && typeof errors === "object" && ERROR_KEYS.every((key) => {
    const n = errors[key]
    return Number.isInteger(n) && n >= 0 && n <= MAX_ERROR_COUNT
  })
  if (!valid) {
    return { error: `Counts must be whole numbers from 0 to ${MAX_ERROR_COUNT}.` }
  }
  return updateSample(id, { errors: normalizeErrors(errors) }, "errors", (r) => ({ errors: normalizeErrors(r.errors) }))
}

export async function saveDieth(id: string, dieth: string): Promise<{ dieth: string } | { error: string }> {
  const trimmed = dieth.trim()
  if (trimmed.length > 5000) {
    return { error: "The transcript can be at most 5000 characters long." }
  }
  return updateSample(id, { dieth: trimmed }, "dieth", (r) => ({ dieth: String(r.dieth ?? "") }))
}

// the transcript and dialect of the user's own recordings; access rules reject changes to those
// of generated samples
export async function saveTranscript(id: string, text: string): Promise<{ text: string } | { error: string }> {
  const trimmed = text.trim()
  if (trimmed.length > MAX_TRANSCRIPT_CHARS) {
    return { error: `The transcript can be at most ${MAX_TRANSCRIPT_CHARS} characters long.` }
  }
  return updateSample(id, { text: trimmed }, "text", (r) => ({ text: String(r.text ?? "") }))
}

export async function saveRecordingDialect(id: string, language: string): Promise<{ language: string } | { error: string }> {
  const models = await getModels(await requireToken())
  if ("error" in models) {
    return { error: "The list of dialects is unavailable. Try again later." }
  }
  if (!allDialects(models).some((l) => l.code === language)) {
    return { error: "Unknown dialect." }
  }
  return updateSample(id, { language }, "language", (r) => ({ language: String(r.language) }))
}

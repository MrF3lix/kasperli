import "server-only"
import { Zip, ZipDeflate, ZipPassThrough } from "fflate"
import type PocketBase from "pocketbase"
import { ClientResponseError, type RecordModel } from "pocketbase"
import { ERROR_KEYS, type ErrorCounts, isAnnotated, normalizeErrors, totalErrors } from "@/lib/annotations"
import { getCurrentUser, requireToken } from "@/lib/auth"
import { isRecordId } from "@/lib/files"
import { fetchGateway, getModels } from "@/lib/gateway"
import { createPocketBase } from "@/lib/pocketbase"
import { displayNames, type Job, MAX_TRANSCRIPT_CHARS, RECORDING_MODEL } from "@/lib/tts"
import { wavDuration } from "@/lib/wav-info"

export type SavedSample = {
  id: string
  text: string
  language: string
  model: string
  // null for recordings
  seed: number | null
  duration_s: number
  note: string
  created: string
  // the saved speaker, or who recorded it
  speakerName: string | null
  isRecording: boolean
  // total of the annotated deviations, null if not annotated
  errorTotal: number | null
  hasDieth: boolean
}

export const PAGE_SIZE = 5

export class KeepError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function jobFilter(pb: ReturnType<typeof createPocketBase>, userId: string, jobId: string, index?: number) {
  return index === undefined
    ? pb.filter("owner = {:owner} && job_id = {:job}", { owner: userId, job: jobId })
    : pb.filter("owner = {:owner} && job_id = {:job} && sample_index = {:index}", { owner: userId, job: jobId, index })
}

/**
 * Copies a finished sample from the gateway (which deletes it after 24h) into the user's saved
 * samples, with the job's settings. Keeping the same sample twice returns the existing record.
 */
export async function keepSample(token: string, userId: string, jobId: string, index: number, speakerId: string | null): Promise<string> {
  const pb = createPocketBase(token)
  const existing = await pb.collection("samples").getList(1, 1, { filter: jobFilter(pb, userId, jobId, index), fields: "id" })
  if (existing.items.length) {
    return existing.items[0].id
  }

  const jobResponse = await fetchGateway(token, `/jobs/${jobId}`)
  if (jobResponse.status === 404) {
    throw new KeepError("This job has expired.", 404)
  }
  if (!jobResponse.ok) {
    throw new KeepError("The TTS service is not reachable.", 502)
  }
  const job: Job = await jobResponse.json()
  const sample = job.samples.find((s) => s.index === index)
  if (!sample || sample.status !== "completed") {
    throw new KeepError("This variant is not finished.", 409)
  }
  const audio = await fetchGateway(token, `/jobs/${jobId}/samples/${index}.wav`)
  if (!audio.ok) {
    throw new KeepError(audio.status === 404 ? "This variant has expired." : "The TTS service is not reachable.", audio.status === 404 ? 404 : 502)
  }

  try {
    const record = await pb.collection("samples").create({
      owner: userId,
      speaker: speakerId ?? "",
      audio: new File([await audio.arrayBuffer()], `${jobId}-${index}.wav`, { type: "audio/wav" }),
      text: job.text,
      ref_text: job.ref_text ?? "",
      language: job.language,
      model: job.model,
      seed: sample.seed,
      duration_s: sample.duration_s ?? 0,
      job_id: jobId,
      sample_index: index,
    }, { fields: "id" })
    return record.id
  } catch (e) {
    // kept twice at the same time (unique index on job_id + sample_index)
    if (e instanceof ClientResponseError && e.status === 400) {
      const again = await pb.collection("samples").getList(1, 1, { filter: jobFilter(pb, userId, jobId, index), fields: "id" })
      if (again.items.length) return again.items[0].id
      // e.g. a speaker of another user or a deleted one
      throw new KeepError("The sample could not be saved.", 400)
    }
    throw e
  }
}

export async function unkeepSample(token: string, userId: string, jobId: string, index: number) {
  const pb = createPocketBase(token)
  const existing = await pb.collection("samples").getList(1, 1, { filter: jobFilter(pb, userId, jobId, index), fields: "id" })
  for (const record of existing.items) {
    await pb.collection("samples").delete(record.id)
  }
}

/** Indices of a job's samples that the user has kept. */
export async function keptIndices(token: string, userId: string, jobId: string): Promise<number[]> {
  const pb = createPocketBase(token)
  const records = await pb.collection("samples").getFullList({ filter: jobFilter(pb, userId, jobId), fields: "sample_index" })
  return records.map((r) => r.sample_index)
}

/**
 * Saves a recording of the signed-in user (a 16-bit mono WAV, as the Record page converts it) as
 * a sample in this dialect, with the user's name as the speaker. The transcript can be empty and
 * added later. Returns the new sample's id.
 */
export async function saveRecording(audio: File, language: string, text: string): Promise<string> {
  const user = await getCurrentUser()
  const pb = createPocketBase(await requireToken())
  const duration = wavDuration(await audio.arrayBuffer())
  if (duration === null) {
    throw new KeepError("The recording is not a WAV file.", 400)
  }
  const transcript = text.trim()
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new KeepError(`The transcript can be at most ${MAX_TRANSCRIPT_CHARS} characters long.`, 400)
  }
  const date = new Date().toISOString().replace(/[:.]/g, "-")
  try {
    const record = await pb.collection("samples").create({
      owner: user.id,
      speaker_name: user.name,
      audio: new File([audio], `recording-${date}.wav`, { type: "audio/wav" }),
      text: transcript,
      language,
      model: RECORDING_MODEL,
      duration_s: Math.round(duration * 100) / 100,
    }, { fields: "id" })
    return record.id
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 400) {
      console.error("saving a recording was rejected", e.response)
      throw new KeepError("The recording could not be saved. It may be too long.", 400)
    }
    throw e
  }
}

/** Where the next page of saved samples starts: after this sample (newest first). */
export type SampleCursor = { created: string; id: string }

/**
 * The signed-in user's saved samples after `cursor` (from the newest without one), at most
 * PAGE_SIZE. A cursor instead of page numbers keeps pages stable while samples are saved or
 * deleted. Only the first page counts the samples, which costs an extra query.
 */
export async function listSamples(cursor?: SampleCursor): Promise<{ items: SavedSample[]; total: number | null; next: SampleCursor | null }> {
  const user = await getCurrentUser()
  const pb = createPocketBase(await requireToken())
  const filter = cursor
    ? pb.filter("owner = {:owner} && (created < {:created} || (created = {:created} && id < {:id}))", { owner: user.id, ...cursor })
    : pb.filter("owner = {:owner}", { owner: user.id })
  // one more than a page, to tell whether there is another one
  const result = await pb.collection("samples").getList(1, PAGE_SIZE + 1, {
    filter,
    sort: "-created,-id",
    fields: "id,text,language,model,seed,duration_s,note,errors,dieth,created,speaker_name,expand.speaker.name",
    expand: "speaker",
    skipTotal: !!cursor,
  })
  const page = result.items.slice(0, PAGE_SIZE)
  const last = page.at(-1)
  return {
    total: cursor ? null : result.totalItems,
    next: result.items.length > PAGE_SIZE && last ? { created: last.created, id: last.id } : null,
    items: page.map(toSavedSample),
  }
}

/** A sample record (with its speaker expanded) for the sample lists. */
export function toSavedSample(r: RecordModel): SavedSample {
  const isRecording = r.model === RECORDING_MODEL
  return {
    id: r.id,
    text: r.text,
    language: r.language,
    model: r.model,
    seed: isRecording ? null : r.seed,
    duration_s: r.duration_s,
    note: r.note,
    created: r.created,
    speakerName: r.expand?.speaker?.name || r.speaker_name || null,
    isRecording,
    errorTotal: isAnnotated(r.errors) ? totalErrors(normalizeErrors(r.errors)) : null,
    hasDieth: !!r.dieth,
  }
}

export type AnnotatedSample = SavedSample & {
  ref_text: string
  checkpoint: string
  sample_index: number
  job_id: string
  errors: ErrorCounts
  annotated: boolean
  dieth: string
}

/**
 * One of the signed-in user's saved samples with its annotation, and the ids of the next older
 * and newer ones (in the order of the Saved page), or null if there is no such sample.
 */
export async function getAnnotatedSample(id: string): Promise<{ sample: AnnotatedSample; older: string | null; newer: string | null } | null> {
  if (!isRecordId(id)) {
    return null
  }
  const user = await getCurrentUser()
  const pb = createPocketBase(await requireToken())
  let r: RecordModel
  try {
    r = await pb.collection("samples").getOne(id, { expand: "speaker" })
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null
    throw e
  }
  // samples of others in a shared dataset are visible too, but not annotated here
  if (r.owner !== user.id) {
    return null
  }
  const neighbour = async (filter: string, sort: string) => {
    const result = await pb.collection("samples").getList(1, 1, {
      filter: pb.filter(`owner = {:owner} && (${filter})`, { owner: user.id, created: r.created, id: r.id }),
      sort,
      fields: "id",
      skipTotal: true,
    })
    return result.items[0]?.id ?? null
  }
  const [older, newer] = await Promise.all([
    neighbour("created < {:created} || (created = {:created} && id < {:id})", "-created,-id"),
    neighbour("created > {:created} || (created = {:created} && id > {:id})", "created,id"),
  ])
  return {
    older,
    newer,
    sample: {
      ...toSavedSample(r),
      ref_text: r.ref_text,
      checkpoint: r.checkpoint,
      job_id: r.job_id,
      sample_index: r.sample_index,
      errors: normalizeErrors(r.errors),
      annotated: isAnnotated(r.errors),
      dieth: r.dieth ?? "",
    },
  }
}

// most sample ids one export request can list (selected or, with "all", left out)
export const MAX_EXPORT_IDS = 1000

/** The samples to export: these ones, or all of the user's samples except these. */
export type ExportSelection = { ids: string[] } | { allExcept: string[] }

/**
 * A selection as the Saved page sends it: {"ids": [...]} for these samples, or
 * {"all": true, "exclude": [...]} for all of them except some (including ones the page hasn't
 * loaded). Returns a message for the user if it isn't valid.
 */
export function parseSelection(body: unknown): ExportSelection | { error: string } {
  const { all, exclude, ids } = (body ?? {}) as { all?: unknown; exclude?: unknown; ids?: unknown }
  const list = all === true ? exclude ?? [] : ids
  const unique = Array.isArray(list) ? [...new Set(list)] : null
  if (!unique || (all !== true && !unique.length) || !unique.every((id) => typeof id === "string" && isRecordId(id))) {
    return { error: "Select the samples first." }
  }
  if (unique.length > MAX_EXPORT_IDS) {
    return { error: `Select all samples or at most ${MAX_EXPORT_IDS} single ones.` }
  }
  return all === true ? { allExcept: unique as string[] } : { ids: unique as string[] }
}

const SAMPLE_COLUMNS = [
  "file", "id", "created", "model", "model_name", "language", "language_name", "speaker", "speaker_id",
  "speaker_file", "text", "ref_text", "seed", "duration_s", "checkpoint", "rating", "tags", "note", "dieth",
  "errors_total", "job_id", "sample_index",
] as const

// one column per error category, empty for samples that weren't annotated
const ERROR_COLUMNS = ERROR_KEYS.map((key) => `errors_${key}` as const)

const SPEAKER_COLUMNS = ["file", "id", "name", "consent", "created"] as const

type CsvValue = string | number | boolean | string[] | null
type SampleRow = Record<(typeof SAMPLE_COLUMNS)[number] | (typeof ERROR_COLUMNS)[number], CsvValue>
type SpeakerRow = Record<(typeof SPEAKER_COLUMNS)[number], CsvValue>

function csvField(value: CsvValue): string {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "")
  return `"${text.replaceAll('"', '""')}"`
}

// with a byte order mark, so spreadsheet apps read the dialect names as UTF-8
function toCsv<C extends string>(columns: readonly C[], rows: Record<C, CsvValue>[]): string {
  return "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((c) => csvField(row[c])).join(","))].join("\r\n") + "\r\n"
}

/**
 * The user's own samples in the selection, newest first, with their speakers (ids of other or
 * deleted samples are skipped).
 */
export async function selectSamples(pb: PocketBase, userId: string, selection: ExportSelection, fields?: string): Promise<RecordModel[]> {
  const records: RecordModel[] = []
  if ("allExcept" in selection) {
    const excluded = new Set(selection.allExcept)
    const all = await pb.collection("samples").getFullList({ filter: pb.filter("owner = {:owner}", { owner: userId }), expand: "speaker", fields })
    records.push(...all.filter((r) => !excluded.has(r.id)))
  }
  const ids = "ids" in selection ? selection.ids : []
  // keeps the filter short; samples in shared datasets are visible too, so the owner is checked
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const idFilter = chunk.map((_, j) => `id = {:id${j}}`).join(" || ")
    records.push(...await pb.collection("samples").getFullList({
      filter: pb.filter(`owner = {:owner} && (${idFilter})`, { owner: userId, ...Object.fromEntries(chunk.map((id, j) => [`id${j}`, id])) }),
      expand: "speaker",
      fields,
    }))
  }
  return records.sort((a, b) => b.created.localeCompare(a.created))
}

/**
 * A zip of the selected samples of the user, or null if none of the samples exist.
 * See zipSamples for its contents.
 */
export async function exportSamples(token: string, userId: string, selection: ExportSelection): Promise<ReadableStream<Uint8Array> | null> {
  const pb = createPocketBase(token)
  const records = await selectSamples(pb, userId, selection)
  return records.length ? zipSamples(pb, token, records) : null
}

/**
 * A zip of these sample records (with their speakers expanded): the audio under audio/, the
 * reference recordings of their speakers under speakers/, and all metadata and notes in
 * metadata.csv/.json and speakers.csv/.json, plus any extra text files. Audio is streamed from
 * PocketBase one file at a time, so large exports don't have to fit in memory.
 */
export async function zipSamples(pb: PocketBase, token: string, records: RecordModel[], extraFiles: Record<string, string> = {}): Promise<ReadableStream<Uint8Array>> {
  // each speaker once, even if several samples were generated from it
  const speakers = new Map<string, RecordModel>()
  for (const r of records) {
    const speaker: RecordModel | undefined = r.expand?.speaker
    if (speaker) speakers.set(speaker.id, speaker)
  }
  const speakerFile = (speaker: RecordModel) => `speakers/${speaker.id}.wav`

  // model and dialect names, if the gateway is reachable
  const models = await getModels(token)
  const { modelNames, languageNames } = displayNames("error" in models ? [] : models)

  const sampleRows: SampleRow[] = records.map((r) => {
    const speaker: RecordModel | undefined = r.expand?.speaker
    const isRecording = r.model === RECORDING_MODEL
    const annotated = isAnnotated(r.errors)
    const errors = normalizeErrors(r.errors)
    return {
      file: `audio/${r.id}.wav`,
      id: r.id,
      created: r.created,
      model: r.model,
      model_name: modelNames[r.model] ?? null,
      language: r.language,
      language_name: languageNames[`${r.model}/${r.language}`] ?? null,
      speaker: speaker?.name || r.speaker_name || null,
      speaker_id: speaker?.id ?? null,
      speaker_file: speaker ? speakerFile(speaker) : null,
      text: r.text,
      ref_text: r.ref_text || null,
      seed: isRecording ? null : r.seed,
      duration_s: r.duration_s,
      checkpoint: r.checkpoint || null,
      rating: r.rating || null,
      tags: Array.isArray(r.tags) ? r.tags : null,
      note: r.note || null,
      dieth: r.dieth || null,
      errors_total: annotated ? totalErrors(errors) : null,
      job_id: r.job_id || null,
      sample_index: isRecording ? null : r.sample_index,
      ...Object.fromEntries(ERROR_KEYS.map((key) => [`errors_${key}`, annotated ? errors[key] : null])),
    }
  })
  const speakerRows: SpeakerRow[] = [...speakers.values()].map((s) => ({
    file: speakerFile(s),
    id: s.id,
    name: s.name || null,
    consent: s.consent,
    created: s.created,
  }))

  // protected files need a short-lived file token
  const fileToken = await pb.files.getToken()

  return new ReadableStream({
    async start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error)
          return
        }
        controller.enqueue(chunk)
        if (final) controller.close()
      })
      const addText = (name: string, text: string) => {
        const file = new ZipDeflate(name, { level: 6 })
        zip.add(file)
        file.push(new TextEncoder().encode(text), true)
      }
      const addAudio = async (name: string, record: RecordModel) => {
        const response = await fetch(pb.files.getURL(record, record.audio, { token: fileToken }), { cache: "no-store" })
        if (!response.ok || !response.body) {
          throw new Error(`loading ${record.collectionName}/${record.id}/audio failed with ${response.status}`)
        }
        // WAV barely compresses, so it is stored as is
        const file = new ZipPassThrough(name)
        file.mtime = new Date(record.created)
        zip.add(file)
        const reader = response.body.getReader()
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
          file.push(read.value)
        }
        file.push(new Uint8Array(0), true)
      }
      try {
        for (const [name, text] of Object.entries(extraFiles)) {
          addText(name, text)
        }
        addText("metadata.csv", toCsv([...SAMPLE_COLUMNS, ...ERROR_COLUMNS], sampleRows))
        addText("metadata.json", JSON.stringify(sampleRows, null, 2) + "\n")
        if (speakers.size) {
          addText("speakers.csv", toCsv(SPEAKER_COLUMNS, speakerRows))
          addText("speakers.json", JSON.stringify(speakerRows, null, 2) + "\n")
        }
        for (const record of records) {
          await addAudio(`audio/${record.id}.wav`, record)
        }
        for (const speaker of speakers.values()) {
          await addAudio(speakerFile(speaker), speaker)
        }
        zip.end()
      } catch (e) {
        console.error("exporting samples failed", e)
        zip.terminate()
        controller.error(e)
      }
    },
  })
}

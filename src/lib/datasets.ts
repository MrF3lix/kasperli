import "server-only"
import { randomInt } from "node:crypto"
import type PocketBase from "pocketbase"
import { ClientResponseError, type RecordModel } from "pocketbase"
import { getCurrentUser, requireToken } from "@/lib/auth"
import { isRecordId } from "@/lib/files"
import { createPocketBase } from "@/lib/pocketbase"
import { type ExportSelection, type SavedSample, selectSamples, toSavedSample, zipSamples } from "@/lib/samples"

// Datasets: named sets of saved samples, shared with other users. Everyone with access (the
// owner and the added users) can rename them, change who has access, and add their own saved
// samples or remove any; only the owner can delete them. Access rules in PocketBase enforce this
// (pocketbase/pb_migrations/1761750005_datasets.js).

export type UserRef = { id: string; name: string; email: string }

export type DatasetSummary = {
  id: string
  name: string
  owner: UserRef
  // other users with access
  users: UserRef[]
  sampleCount: number
  created: string
  updated: string
}

export type DatasetSample = SavedSample & {
  // the dataset_samples record, for removing the sample from the dataset
  linkId: string
  // who saved it; samples of others can be played but not annotated
  owner: UserRef
}

export type Dataset = DatasetSummary & { samples: DatasetSample[] }

export const MAX_NAME_LENGTH = 200
// PocketBase runs at most 1001 requests per batch (settings in the migration)
const BATCH_SIZE = 1000

export class DatasetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function toUser(r: RecordModel | undefined): UserRef {
  return { id: r?.id ?? "", name: r?.name || r?.email || "Unknown user", email: r?.email ?? "" }
}

function toSummary(r: RecordModel, sampleCount: number): DatasetSummary {
  return {
    id: r.id,
    name: r.name,
    owner: toUser(r.expand?.owner),
    users: (r.expand?.users ?? []).map(toUser).sort(byName),
    sampleCount,
    created: r.created,
    updated: r.updated,
  }
}

const byName = (a: UserRef, b: UserRef) => a.name.localeCompare(b.name)

function validName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : ""
  if (!trimmed) throw new DatasetError("Give the dataset a name.")
  if (trimmed.length > MAX_NAME_LENGTH) throw new DatasetError(`Names can be at most ${MAX_NAME_LENGTH} characters long.`)
  return trimmed
}

function validUserIds(ids: unknown, ownerId: string): string[] {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && isRecordId(id))) {
    throw new DatasetError("Unknown users.")
  }
  // the owner always has access
  return [...new Set(ids as string[])].filter((id) => id !== ownerId)
}

// PocketBase record ids: 15 lowercase letters and digits
function newRecordId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 15 }, () => chars[randomInt(chars.length)]).join("")
}

function rethrow(e: unknown, action: string): never {
  if (e instanceof DatasetError) throw e
  if (e instanceof ClientResponseError && e.status === 404) throw new DatasetError("This dataset no longer exists.", 404)
  if (e instanceof ClientResponseError && e.status === 403) throw new DatasetError("You can't change this dataset.", 403)
  console.error(`${action} failed`, e)
  throw new DatasetError(`${action[0].toUpperCase()}${action.slice(1)} failed. Try again later.`, 500)
}

/** All users, for choosing who has access to a dataset. */
export async function listUsers(): Promise<UserRef[]> {
  const pb = createPocketBase(await requireToken())
  const records = await pb.collection("users").getFullList({ fields: "id,name,email" })
  return records.map(toUser).sort(byName)
}

/** The datasets the signed-in user owns or has access to, last changed first. */
export async function listDatasets(): Promise<DatasetSummary[]> {
  const pb = createPocketBase(await requireToken())
  const [datasets, links] = await Promise.all([
    pb.collection("datasets").getFullList({ sort: "-updated", expand: "owner,users" }),
    // access rules only return the samples of datasets the user has access to
    pb.collection("dataset_samples").getFullList({ fields: "dataset" }),
  ])
  const counts = new Map<string, number>()
  for (const link of links) counts.set(link.dataset, (counts.get(link.dataset) ?? 0) + 1)
  return datasets.map((r) => toSummary(r, counts.get(r.id) ?? 0))
}

async function loadDataset(pb: PocketBase, id: string): Promise<{ record: RecordModel; links: RecordModel[] } | null> {
  if (!isRecordId(id)) return null
  try {
    const [record, links] = await Promise.all([
      pb.collection("datasets").getOne(id, { expand: "owner,users" }),
      pb.collection("dataset_samples").getFullList({
        filter: pb.filter("dataset = {:id}", { id }),
        // newest first, like the Saved page
        sort: "-sample.created,-id",
        expand: "sample,sample.speaker,sample.owner",
      }),
    ])
    // samples the user can't see (shouldn't happen) are left out
    return { record, links: links.filter((l) => l.expand?.sample) }
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) return null
    throw e
  }
}

/** A dataset with its samples (newest first), or null if the user has no access. */
export async function getDataset(id: string): Promise<Dataset | null> {
  const pb = createPocketBase(await requireToken())
  const result = await loadDataset(pb, id)
  if (!result) return null
  const { record, links } = result
  return {
    ...toSummary(record, links.length),
    samples: links.map((l) => ({
      ...toSavedSample(l.expand!.sample),
      linkId: l.id,
      owner: toUser(l.expand!.sample.expand?.owner),
    })),
  }
}

// marks the dataset as changed when its samples change, for the order of the Datasets page
async function touch(pb: PocketBase, id: string) {
  await pb.collection("datasets").update(id, {}, { fields: "id" })
}

/** Adds the samples (ids of the user's own samples) to a dataset in batches, skipping ones it has. */
async function linkSamples(pb: PocketBase, datasetId: string, sampleIds: string[], first?: (batch: ReturnType<PocketBase["createBatch"]>) => void) {
  for (let i = 0; i === 0 || i < sampleIds.length; i += BATCH_SIZE) {
    const batch = pb.createBatch()
    if (i === 0) first?.(batch)
    for (const sample of sampleIds.slice(i, i + BATCH_SIZE)) {
      batch.collection("dataset_samples").create({ dataset: datasetId, sample }, { fields: "id" })
    }
    await batch.send()
  }
}

/**
 * Creates a dataset owned by the signed-in user with the selected samples of theirs and returns
 * its id. Up to 1000 samples are added in one transaction with the dataset, more in further ones.
 */
export async function createDataset(name: unknown, selection: ExportSelection): Promise<string> {
  const user = await getCurrentUser()
  const pb = createPocketBase(await requireToken())
  const validated = validName(name)
  try {
    const samples = await selectSamples(pb, user.id, selection, "id,created")
    if (!samples.length) throw new DatasetError("The selected samples no longer exist.", 404)
    const id = newRecordId()
    await linkSamples(pb, id, samples.map((s) => s.id), (batch) => {
      batch.collection("datasets").create({ id, owner: user.id, name: validated, users: [] }, { fields: "id" })
    })
    return id
  } catch (e) {
    rethrow(e, "saving the dataset")
  }
}

/** Renames a dataset and sets who else has access to it. */
export async function updateDataset(id: string, name: unknown, userIds: unknown): Promise<void> {
  const pb = createPocketBase(await requireToken())
  const validated = validName(name)
  try {
    const record = await pb.collection("datasets").getOne(id, { fields: "owner" })
    await pb.collection("datasets").update(id, { name: validated, users: validUserIds(userIds, record.owner) }, { fields: "id" })
  } catch (e) {
    rethrow(e, "saving the dataset")
  }
}

/** Adds the selected samples of the signed-in user to a dataset; returns how many were new. */
export async function addSamples(id: string, selection: ExportSelection): Promise<number> {
  const user = await getCurrentUser()
  const pb = createPocketBase(await requireToken())
  try {
    const result = await loadDataset(pb, id)
    if (!result) throw new DatasetError("This dataset no longer exists.", 404)
    const present = new Set(result.links.map((l) => l.sample))
    const samples = await selectSamples(pb, user.id, selection, "id,created")
    const added = samples.map((s) => s.id).filter((s) => !present.has(s))
    if (added.length) {
      await linkSamples(pb, id, added)
      await touch(pb, id)
    }
    return added.length
  } catch (e) {
    rethrow(e, "adding the samples")
  }
}

/** Removes samples (by their dataset_samples ids) from a dataset; the saved samples stay. */
export async function removeSamples(id: string, linkIds: unknown): Promise<void> {
  if (!Array.isArray(linkIds) || !linkIds.every((l) => typeof l === "string" && isRecordId(l))) {
    throw new DatasetError("Unknown samples.")
  }
  const pb = createPocketBase(await requireToken())
  try {
    const result = await loadDataset(pb, id)
    if (!result) throw new DatasetError("This dataset no longer exists.", 404)
    const ofDataset = new Set(result.links.map((l) => l.id))
    const removed = (linkIds as string[]).filter((l) => ofDataset.has(l))
    for (let i = 0; i < removed.length; i += BATCH_SIZE) {
      const batch = pb.createBatch()
      for (const link of removed.slice(i, i + BATCH_SIZE)) batch.collection("dataset_samples").delete(link)
      await batch.send()
    }
    if (removed.length) await touch(pb, id)
  } catch (e) {
    rethrow(e, "removing the samples")
  }
}

/** Deletes a dataset (owner only); its samples stay saved. */
export async function deleteDataset(id: string): Promise<void> {
  if (!isRecordId(id)) throw new DatasetError("This dataset no longer exists.", 404)
  const pb = createPocketBase(await requireToken())
  try {
    await pb.collection("datasets").delete(id)
  } catch (e) {
    rethrow(e, "deleting the dataset")
  }
}

/**
 * A zip of a dataset, like an export of saved samples plus dataset.json with its name and who
 * has access, or null if the user has no access. Returns the file name too.
 */
export async function exportDataset(token: string, id: string): Promise<{ zip: ReadableStream<Uint8Array>; filename: string } | null> {
  const pb = createPocketBase(token)
  const result = await loadDataset(pb, id)
  if (!result) return null
  const { record, links } = result
  const summary = toSummary(record, links.length)
  const info = {
    id: summary.id,
    name: summary.name,
    owner: summary.owner,
    users: summary.users,
    created: summary.created,
    updated: summary.updated,
    samples: links.map((l) => ({ id: l.sample, owner: toUser(l.expand!.sample.expand?.owner), added: l.created })),
  }
  const samples = links.map((l) => l.expand!.sample as RecordModel)
  const slug = summary.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "dataset"
  return {
    zip: await zipSamples(pb, token, samples, { "dataset.json": JSON.stringify(info, null, 2) + "\n" }),
    filename: `dataset-${slug}-${new Date().toISOString().slice(0, 10)}.zip`,
  }
}

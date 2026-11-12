"use server"

import { revalidatePath } from "next/cache"
import { addSamples, createDataset, DatasetError, deleteDataset, removeSamples, updateDataset } from "@/lib/datasets"
import { parseSelection } from "@/lib/samples"

// The dataset pages are rendered per request; revalidating keeps going back in the browser from
// showing a cached copy after a change.

type Result<T extends object = object> = (T & { error?: undefined }) | { error: string }

async function run<T extends object>(action: () => Promise<T>, paths: string[]): Promise<Result<T>> {
  try {
    const result = await action()
    for (const path of paths) revalidatePath(path)
    return result
  } catch (e) {
    if (e instanceof DatasetError) return { error: e.message }
    console.error("dataset action failed", e)
    return { error: "Something went wrong. Try again later." }
  }
}

/** Creates a dataset from samples selected on the Saved page. */
export async function createDatasetAction(name: string, selection: unknown): Promise<Result<{ id: string }>> {
  const parsed = parseSelection(selection)
  if ("error" in parsed) return parsed
  return run(async () => ({ id: await createDataset(name, parsed) }), ["/dataset"])
}

export async function updateDatasetAction(id: string, name: string, userIds: string[]): Promise<Result> {
  return run(async () => { await updateDataset(id, name, userIds); return {} }, ["/dataset", `/dataset/${id}`])
}

/** Adds the user's own samples, selected like on the Saved page, to a dataset. */
export async function addSamplesAction(id: string, selection: unknown): Promise<Result<{ added: number }>> {
  const parsed = parseSelection(selection)
  if ("error" in parsed) return parsed
  return run(async () => ({ added: await addSamples(id, parsed) }), ["/dataset", `/dataset/${id}`])
}

/** Removes samples from a dataset by their ids in the dataset (DatasetSample.linkId). */
export async function removeSamplesAction(id: string, linkIds: string[]): Promise<Result> {
  return run(async () => { await removeSamples(id, linkIds); return {} }, ["/dataset", `/dataset/${id}`])
}

export async function deleteDatasetAction(id: string): Promise<Result> {
  return run(async () => { await deleteDataset(id); return {} }, ["/dataset"])
}

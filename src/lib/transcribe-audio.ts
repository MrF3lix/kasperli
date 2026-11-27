// The audio of transcription jobs, kept in this browser (IndexedDB) so a transcript's segments
// can be played: the STT gateway deletes uploads once they are transcribed. Kept as long as the
// gateway keeps the transcripts (24h). Every function fails quietly: without storage (private
// mode, quota) there is just no player.

const DB_NAME = "transcribe-audio"
const STORE = "files"
const KEEP_MS = 24 * 60 * 60 * 1000

type Entry = { key: string; jobId: string; index: number; blob: Blob; savedAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" })
      store.createIndex("jobId", "jobId")
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = action(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request ? request.result : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Keeps the files of a job, in the order they were uploaded (= the job's file indexes). */
export async function saveJobAudio(jobId: string, files: File[]): Promise<void> {
  try {
    const savedAt = Date.now()
    await run("readwrite", (store) => {
      files.forEach((blob, index) => store.put({ key: `${jobId}/${index}`, jobId, index, blob, savedAt } satisfies Entry))
    })
  } catch (e) {
    console.warn("keeping the audio for playback failed", e)
  }
}

/** A file's audio, or null if this browser doesn't have it (another browser, expired, no storage). */
export async function loadJobAudio(jobId: string, index: number): Promise<Blob | null> {
  try {
    const entry = await run<Entry | undefined>("readonly", (store) => store.get(`${jobId}/${index}`) as IDBRequest<Entry | undefined>)
    return entry && Date.now() - entry.savedAt < KEEP_MS ? entry.blob : null
  } catch {
    return null
  }
}

export async function deleteJobAudio(jobId: string): Promise<void> {
  try {
    await run("readwrite", (store) => {
      const request = store.index("jobId").openKeyCursor(IDBKeyRange.only(jobId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        store.delete(cursor.primaryKey)
        cursor.continue()
      }
    })
  } catch {
    // nothing to clean up
  }
}

/** Removes audio older than the transcripts it belongs to. */
export async function pruneJobAudio(): Promise<void> {
  try {
    const cutoff = Date.now() - KEEP_MS
    await run("readwrite", (store) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if ((cursor.value as Entry).savedAt < cutoff) cursor.delete()
        cursor.continue()
      }
    })
  } catch {
    // nothing to clean up
  }
}

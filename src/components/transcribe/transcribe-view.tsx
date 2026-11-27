"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { TranscribeForm } from "@/components/transcribe/transcribe-form"
import { TranscribeJobCard } from "@/components/transcribe/transcribe-job-card"
import type { TranscribeJob } from "@/lib/transcribe"
import { deleteJobAudio, pruneJobAudio } from "@/lib/transcribe-audio"
import type { SttModel } from "@/lib/transcription-client"

const MAX_JOBS = 20

// a submitted job; initial: the state the submission returned, so it shows without a first poll
export type TranscribeEntry = { id: string; initial?: TranscribeJob }

// The STT gateway can't list a user's jobs, so recent ones are kept in this browser (the jobs
// themselves expire on the gateway after 24h).
function storageKey(userId: string) {
  return `transcribe.jobs.${userId}`
}

function load(userId: string): TranscribeEntry[] {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]")
    return Array.isArray(items) ? items.filter((id) => typeof id === "string").slice(0, MAX_JOBS).map((id) => ({ id })) : []
  } catch {
    return []
  }
}

function save(userId: string, entries: TranscribeEntry[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entries.map((e) => e.id)))
  } catch {
    // storage unavailable (private mode): the list just doesn't survive a reload
  }
}

export function TranscribeView({ models, userId }: { models: SttModel[]; userId: string }) {
  const [entries, setEntries] = useState<TranscribeEntry[] | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setEntries(load(userId))
    void pruneJobAudio()
  }, [userId])

  const update = useCallback((change: (entries: TranscribeEntry[]) => TranscribeEntry[]) => {
    setEntries((current) => {
      const next = change(current ?? []).slice(0, MAX_JOBS)
      save(userId, next)
      return next
    })
  }, [userId])

  const add = useCallback((job: TranscribeJob) => update((list) => [{ id: job.id, initial: job }, ...list]), [update])
  const remove = useCallback((id: string) => {
    void deleteJobAudio(id)
    update((list) => list.filter((e) => e.id !== id))
  }, [update])

  return (
    <div className="grid gap-8">
      <Card>
        <CardContent>
          <TranscribeForm models={models} onSubmitted={add} />
        </CardContent>
      </Card>
      {entries && entries.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-medium">Recent transcriptions</h2>
          <p className="-mt-2 text-sm text-muted-foreground">Transcripts are deleted after 24 hours. Download what you want to keep.</p>
          {entries.map((entry) => (
            <TranscribeJobCard key={entry.id} entry={entry} models={models} onRemove={remove} />
          ))}
        </section>
      )}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { AnonymizeForm } from "@/components/anonymize/anonymize-form"
import { AnonymizeJobCard } from "@/components/anonymize/anonymize-job-card"
import type { AnonymizeJob, AnonymizerModel } from "@/lib/anonymize"
import type { Speaker } from "@/lib/speakers"

const MAX_JOBS = 20

// One submission: a job per variant. target and reference: names of the recordings, for telling
// submissions apart; id: the first job's, as the entry's key
export type AnonymizeEntry = { id: string; ids: string[]; target: string; reference: string; initial?: AnonymizeJob[] }
type Stored = Omit<AnonymizeEntry, "initial">

// The anonymizer can't list a user's jobs, so recent jobs are kept in this browser (the jobs
// themselves expire on the anonymizer after 24h).
function storageKey(userId: string) {
  return `anonymize.jobs.${userId}`
}

function load(userId: string): Stored[] {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "[]")
    if (!Array.isArray(items)) return []
    return items
      .filter((item) => typeof item?.id === "string")
      // entries from before variants had a single job
      .map((item): Stored => ({ ...item, ids: Array.isArray(item.ids) ? item.ids : [item.id] }))
      .slice(0, MAX_JOBS)
  } catch {
    return []
  }
}

function save(userId: string, entries: AnonymizeEntry[]) {
  try {
    const stored: Stored[] = entries.map(({ id, ids, target, reference }) => ({ id, ids, target, reference }))
    localStorage.setItem(storageKey(userId), JSON.stringify(stored))
  } catch {
    // storage unavailable (private mode): the list just doesn't survive a reload
  }
}

export function AnonymizeView({ models, speakers, userId }: { models: AnonymizerModel[]; speakers: Speaker[]; userId: string }) {
  // dialect names for the job list, of all models
  const languages = models.flatMap((m) => m.languages)
  const [entries, setEntries] = useState<AnonymizeEntry[] | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setEntries(load(userId))
  }, [userId])

  const update = useCallback((change: (entries: AnonymizeEntry[]) => AnonymizeEntry[]) => {
    setEntries((current) => {
      const next = change(current ?? []).slice(0, MAX_JOBS)
      save(userId, next)
      return next
    })
  }, [userId])

  const add = useCallback((entry: AnonymizeEntry) => update((list) => [entry, ...list]), [update])
  const remove = useCallback((id: string) => update((list) => list.filter((e) => e.id !== id)), [update])

  return (
    <div className="grid gap-8">
      <Card>
        <CardContent>
          <AnonymizeForm models={models} speakers={speakers} onSubmitted={add} />
        </CardContent>
      </Card>
      {entries && entries.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-medium">Recent jobs</h2>
          <p className="-mt-2 text-sm text-muted-foreground">Results are deleted after 24 hours. Download what you want to keep.</p>
          {entries.map((entry) => (
            <AnonymizeJobCard key={entry.id} entry={entry} languages={languages} onRemove={remove} />
          ))}
        </section>
      )}
    </div>
  )
}

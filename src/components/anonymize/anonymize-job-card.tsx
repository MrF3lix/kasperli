"use client"

import { useEffect, useState } from "react"
import { DownloadIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { AnonymizeEntry } from "@/components/anonymize/anonymize-view"
import { cn } from "@/lib/utils"
import { isAnonymizeFinished, type AnonymizeJob, type AnonymizeStatus } from "@/lib/anonymize"
import type { Language } from "@/lib/tts"

type Props = {
  entry: AnonymizeEntry
  languages: Language[]
  onRemove: (id: string) => void
}

const POLL_MS = 2000

const STATUS_LABEL: Record<AnonymizeStatus, string> = {
  queued: "Waiting",
  running: "Anonymizing",
  completed: "Done",
  failed: "Failed",
}

// muted tints, as on the Generate page
const STATUS_COLOR: Record<AnonymizeStatus, string> = {
  queued: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  running: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
}

// the submission's state: running while any variant runs, done once one is, failed if all failed
function overallStatus(jobs: AnonymizeJob[]): AnonymizeStatus {
  if (jobs.some((j) => j.status === "running")) return "running"
  if (jobs.some((j) => j.status === "queued")) return "queued"
  return jobs.some((j) => j.status === "completed") ? "completed" : "failed"
}

/** One submission with a row per variant, polled until every variant is finished. */
export function AnonymizeJobCard({ entry, languages, onRemove }: Props) {
  const { id: entryId, ids } = entry
  // by job id; jobs that expired (404) are dropped
  const [jobs, setJobs] = useState<Record<string, AnonymizeJob>>(
    () => Object.fromEntries((entry.initial ?? []).map((j) => [j.id, j])),
  )
  const [gone, setGone] = useState<Set<string>>(new Set())
  const known = ids.filter((id) => !gone.has(id))
  const loaded = known.every((id) => jobs[id])
  const finished = loaded && known.every((id) => isAnonymizeFinished(jobs[id]))

  // every variant expired after 24h, or was deleted
  useEffect(() => {
    if (known.length === 0) onRemove(entryId)
  }, [known.length, entryId, onRemove])

  // load jobs restored after a reload, and follow unfinished ones
  useEffect(() => {
    if (finished) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll(pending: string[]) {
      const results = await Promise.all(pending.map(async (id) => {
        try {
          const response = await fetch(`/api/anonymize/${id}`, { cache: "no-store" })
          if (response.status === 404) return { id, gone: true as const }
          return response.ok ? { id, job: await response.json() as AnonymizeJob } : null
        } catch {
          return null // network hiccup: try again on the next round
        }
      }))
      if (!active) return
      const updates = results.filter((r) => r && "job" in r) as { id: string; job: AnonymizeJob }[]
      const expired = results.filter((r) => r && "gone" in r).map((r) => r!.id)
      if (updates.length) setJobs((current) => ({ ...current, ...Object.fromEntries(updates.map((u) => [u.id, u.job])) }))
      if (expired.length) setGone((current) => new Set([...current, ...expired]))
      const next = pending.filter((id) => !expired.includes(id) && !updates.find((u) => u.id === id && isAnonymizeFinished(u.job)))
      if (next.length) timer = setTimeout(() => poll(next), POLL_MS)
    }
    const pending = known.filter((id) => !jobs[id] || !isAnonymizeFinished(jobs[id]))
    // jobs just submitted are known already; ask again after the usual interval
    timer = setTimeout(() => poll(pending), pending.every((id) => jobs[id]) ? POLL_MS : 0)
    return () => { active = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the submission finishes
  }, [entryId, finished])

  async function cancel() {
    const queued = known.filter((id) => jobs[id]?.status === "queued")
    await Promise.all(queued.map((id) => fetch(`/api/anonymize/${id}`, { method: "DELETE" }).catch(() => null)))
    setGone((current) => new Set([...current, ...queued]))
  }

  const list = known.map((id) => jobs[id]).filter(Boolean)
  if (list.length === 0) {
    return <Card className="h-28 animate-pulse" />
  }

  const first = list[0]
  const status = overallStatus(list)
  const language = languages.find((l) => l.code === first.language)?.name ?? first.language
  const transcript = list.find((j) => j.transcript)?.transcript ?? (first.text || null)
  const anyQueued = list.some((j) => j.status === "queued")

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm">
            <span className="font-medium">{entry.target}</span>
            <span className="text-muted-foreground"> in the voice of </span>
            <span className="font-medium">{entry.reference}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Badge className={cn("border-transparent", STATUS_COLOR[status])}>{STATUS_LABEL[status]}</Badge>
            {finished && (
              <Button variant="ghost" size="icon-sm" onClick={() => onRemove(entryId)} aria-label="Remove from list">
                <XIcon />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {language} · {new Date(first.created_at * 1000).toLocaleString()}
          {list.length > 1 && ` · ${list.length} variants`}
        </p>
        {transcript && (
          <p className="text-sm">
            <span className="text-muted-foreground">{first.text ? "Transcript: " : "Automatic transcript: "}</span>
            {transcript}
          </p>
        )}
        {!finished && anyQueued && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Waiting for a free worker…</span>
            <Button variant="outline" size="xs" onClick={cancel}>Cancel</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-2">
        {list.map((job, index) => (
          <VariantRow key={job.id} job={job} index={index} numbered={ids.length > 1} />
        ))}
      </CardContent>
    </Card>
  )
}

function VariantRow({ job, index, numbered }: { job: AnonymizeJob; index: number; numbered: boolean }) {
  const src = `/api/anonymize/${job.id}/result`
  const seed = job.seed !== null && (
    <span className="flex-1 text-xs text-muted-foreground tabular-nums sm:flex-none sm:text-right">seed {job.seed}</span>
  )
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-1.5 text-sm">
      {numbered && <span className="w-6 text-muted-foreground tabular-nums">#{index + 1}</span>}
      {job.status === "completed" ? (
        <>
          {/* own line on phones, where a player next to the details would be too narrow */}
          <audio controls preload="none" src={src} className="order-last h-8 w-full sm:order-none sm:w-auto sm:min-w-0 sm:flex-1" />
          {seed}
          <a href={`${src}?download=1`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
             aria-label={`Download variant ${index + 1}`}>
            <DownloadIcon />
          </a>
        </>
      ) : (
        <>
          {job.status === "failed" ? (
            <span className="line-clamp-3 min-w-0 flex-1 break-words whitespace-pre-line text-destructive" title={job.error ?? undefined}>
              Failed{job.error ? `: ${job.error}` : ""}
            </span>
          ) : (
            <span className="flex-1 text-muted-foreground">{job.status === "queued" ? "Waiting…" : "Anonymizing…"}</span>
          )}
          {seed}
        </>
      )}
    </div>
  )
}

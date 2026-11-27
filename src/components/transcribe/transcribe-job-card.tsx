"use client"

import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardHeader } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { SegmentPlayer } from "@/components/transcribe/segment-player"
import type { TranscribeEntry } from "@/components/transcribe/transcribe-view"
import {
  isTranscribeFinished, jobProgress, transcriptUrl, type TranscribeFile, type TranscribeJob, type TranscribeStatus,
} from "@/lib/transcribe"
import type { SttModel } from "@/lib/transcription-client"
import { cn } from "@/lib/utils"

const POLL_MS = 2000

const STATUS_LABEL: Record<TranscribeStatus, string> = {
  queued: "Waiting",
  running: "Transcribing",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
}

// muted tints, as on the Generate and Anonymize pages
const STATUS_COLOR: Record<TranscribeStatus, string> = {
  queued: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  running: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
}

type Props = {
  entry: TranscribeEntry
  models: SttModel[]
  onRemove: (id: string) => void
}

/** One job with a row per file, polled until every file is finished. */
export function TranscribeJobCard({ entry, models, onRemove }: Props) {
  const { id } = entry
  const [job, setJob] = useState<TranscribeJob | null>(entry.initial ?? null)
  const finished = job !== null && isTranscribeFinished(job.status)

  // load a job restored after a reload, and follow it while it is unfinished
  useEffect(() => {
    if (finished) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const response = await fetch(`/api/stt/jobs/${encodeURIComponent(id)}`, { cache: "no-store" })
        if (!active) return
        // expired after 24h
        if (response.status === 404) return onRemove(id)
        if (response.ok) {
          const next: TranscribeJob = await response.json()
          if (!active) return
          setJob(next)
          if (isTranscribeFinished(next.status)) return
        }
      } catch {
        // network hiccup: try again on the next round
      }
      if (active) timer = setTimeout(poll, POLL_MS)
    }
    // a job just submitted is known already; ask again after the usual interval
    timer = setTimeout(poll, job ? POLL_MS : 0)
    return () => {
      active = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the job finishes
  }, [id, finished])

  async function cancel() {
    const response = await fetch(`/api/stt/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
    if (response?.ok) setJob(await response.json())
  }

  if (!job) return <Card className="h-28 animate-pulse" />

  const model = models.find((m) => m.id === job.model)
  const languageName = (code: string | null | undefined) =>
    code ? (model?.languages.find((l) => l.code === code)?.name ?? code) : null
  const anyQueued = job.files.some((f) => f.status === "queued")
  const totalSeconds = job.files.reduce((sum, f) => sum + (f.audio_seconds ?? 0), 0)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="grid gap-1.5 bg-muted/60 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm">
            <span className="font-medium">
              {job.files.length === 1 ? job.files[0].filename : `${job.files.length} files`}
            </span>
            <span className="text-muted-foreground"> · {model?.name ?? job.model}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Badge className={cn("border-transparent", STATUS_COLOR[job.status])}>{STATUS_LABEL[job.status]}</Badge>
            {finished && (
              <Button variant="ghost" size="icon-sm" onClick={() => onRemove(id)} aria-label="Remove from list">
                <XIcon />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {languageName(job.language) ?? "Language detected"}
          {" · "}{duration(totalSeconds)} of audio
          {job.timestamps && " · timestamps"}
          {" · "}{new Date(job.created_at * 1000).toLocaleString()}
        </p>
        {!finished && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {job.status === "running" && <ProgressBar value={jobProgress(job)} className="w-full sm:w-48" />}
            <span>
              {job.queue_position
                ? `${job.queue_position} ${job.queue_position === 1 ? "file" : "files"} ahead in the queue`
                : job.status === "running" ? "Transcribing…" : "Waiting for a free worker…"}
              {job.files.length > 1 && ` · ${job.files_completed} of ${job.files_total} done`}
              {job.eta_seconds != null && ` · about ${duration(job.eta_seconds)} left`}
            </span>
            {anyQueued && <Button variant="outline" size="xs" className="ml-auto" onClick={cancel}>Cancel</Button>}
          </div>
        )}
      </CardHeader>
      <ul className="divide-y border-t">
        {job.files.map((file) => (
          <FileRow key={file.index} job={job} file={file} language={languageName(file.language)} showName={job.files.length > 1} />
        ))}
      </ul>
    </Card>
  )
}

function FileRow({ job, file, language, showName }: { job: TranscribeJob; file: TranscribeFile; language: string | null; showName: boolean }) {
  const [copied, setCopied] = useState(false)
  const done = file.status === "completed"

  async function copy() {
    await navigator.clipboard.writeText(file.text ?? "")
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {showName && <span className="min-w-0 truncate font-medium" title={file.filename}>{file.filename}</span>}
        <span className="text-xs text-muted-foreground">
          {[
            duration(file.audio_seconds),
            language,
            file.processing_seconds != null ? `transcribed in ${duration(file.processing_seconds)}` : null,
          ].filter(Boolean).join(" · ")}
        </span>
        {showName && !done && (
          <Badge className={cn("ml-auto border-transparent", STATUS_COLOR[file.status])}>{STATUS_LABEL[file.status]}</Badge>
        )}
      </div>

      {/* one file: the header's bar is this file's */}
      {showName && file.status === "running" && <ProgressBar value={file.progress ?? 0} />}

      {file.status === "failed" && <p className="text-sm text-destructive">{file.error ?? "The transcription failed."}</p>}

      {done && (
        <>
          {/* with timestamps the segments replace the text, which can be copied or downloaded */}
          {job.timestamps
            ? <SegmentPlayer jobId={job.id} index={file.index} text={file.text?.trim() ?? ""} />
            : <p className="max-h-60 overflow-y-auto text-sm whitespace-pre-wrap">{file.text?.trim() || <span className="text-muted-foreground">(nothing recognized)</span>}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={copy} disabled={!file.text}>
              {copied ? <CheckIcon /> : <CopyIcon />}{copied ? "Copied" : "Copy text"}
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">Download</span>
            {(job.timestamps ? (["txt", "srt", "vtt", "json"] as const) : (["txt", "json"] as const)).map((format) => (
              <a
                key={format}
                href={transcriptUrl(job.id, file.index, format, file.filename)}
                className={buttonVariants({ variant: "outline", size: "xs" })}
                download
              >
                {format.toUpperCase()}
              </a>
            ))}
          </div>
        </>
      )}
    </li>
  )
}

/**
 * Progress of a running transcription with its percentage. At 0 % the worker has not reported
 * yet (the first batch of a file, or a gateway without progress), so the bar pulses instead.
 */
function ProgressBar({ value, className }: { value: number; className?: string }) {
  const percent = Math.round(value * 100)
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Progress
        value={percent}
        aria-label="Transcription progress"
        className={cn("flex-1 [&_[data-slot=progress-indicator]]:duration-1000 [&_[data-slot=progress-indicator]]:ease-linear", percent === 0 && "animate-pulse")}
      />
      <span className="w-9 text-right tabular-nums">{percent === 0 ? "" : `${percent} %`}</span>
    </div>
  )
}

// 4.2 → "4 s", 75 → "1 min 15 s"
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

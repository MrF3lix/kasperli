"use client"

import { useEffect, useRef, useState } from "react"
import { PlayIcon } from "lucide-react"
import { transcriptUrl, type TranscriptSegment } from "@/lib/transcribe"
import { loadJobAudio } from "@/lib/transcribe-audio"
import { cn } from "@/lib/utils"

type Props = {
  jobId: string
  index: number
  // the plain text, shown if the transcript has no segments
  text: string
}

/**
 * A transcript's timed segments with a player for the recording: clicking a segment plays the
 * recording from there, and the segment being played is highlighted. The recording comes from
 * this browser's copy (the gateway doesn't keep it), so in another browser there are only the
 * segments.
 */
export function SegmentPlayer({ jobId, index, text }: Props) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null | "error">(null)
  const [audioUrl, setAudioUrl] = useState<string | null | undefined>(undefined)
  const [active, setActive] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const list = useRef<HTMLOListElement>(null)

  useEffect(() => {
    let alive = true
    fetch(transcriptUrl(jobId, index, "json"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((t: { segments: TranscriptSegment[] | null }) => alive && setSegments(t.segments ?? []))
      .catch(() => alive && setSegments("error"))
    return () => {
      alive = false
    }
  }, [jobId, index])

  useEffect(() => {
    let url: string | null = null
    let alive = true
    void loadJobAudio(jobId, index).then((blob) => {
      if (!alive) return
      url = blob ? URL.createObjectURL(blob) : null
      setAudioUrl(url)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [jobId, index])

  // keep the segment being played in view, inside the list only (not the page)
  useEffect(() => {
    const container = list.current
    const item = active === null ? null : container?.children[active] as HTMLElement | undefined
    if (!container || !item) return
    // the item's position within the scrolled content, from where both are on screen
    const top = item.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    if (top < container.scrollTop || top + item.offsetHeight > container.scrollTop + container.clientHeight) {
      // a third from the top, so the next segments are in view too
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: "smooth" })
    }
  }, [active])

  function timeUpdate() {
    if (!Array.isArray(segments) || !audio.current) return
    const t = audio.current.currentTime
    const i = segments.findIndex((s) => t >= s.start && t < s.end)
    setActive(i === -1 ? null : i)
  }

  function play(segment: TranscriptSegment) {
    const player = audio.current
    if (!player) return
    player.currentTime = segment.start
    void player.play()
  }

  if (segments === null) return <div className="h-24 animate-pulse rounded-lg bg-muted" />
  if (segments === "error") {
    return (
      <>
        <p className="text-xs text-destructive">The segments could not be loaded.</p>
        <p className="max-h-60 overflow-y-auto text-sm whitespace-pre-wrap">{text}</p>
      </>
    )
  }
  if (segments.length === 0) {
    return <p className="text-sm whitespace-pre-wrap">{text || <span className="text-muted-foreground">(nothing recognized)</span>}</p>
  }

  const playable = Boolean(audioUrl)
  return (
    <div className="grid gap-2">
      {audioUrl && (
        <audio
          ref={audio}
          src={audioUrl}
          controls
          preload="metadata"
          className="h-9 w-full"
          onTimeUpdate={timeUpdate}
          onSeeked={timeUpdate}
          onEnded={() => setActive(null)}
        />
      )}
      {audioUrl === null && (
        <p className="text-xs text-muted-foreground">
          The recording is only kept in the browser it was uploaded from, so it can&apos;t be played here.
        </p>
      )}
      <ol ref={list} className="relative max-h-96 overflow-y-auto rounded-lg border text-sm">
        {segments.map((s, i) => (
          <li key={i} className="border-b last:border-b-0">
            <button
              type="button"
              disabled={!playable}
              onClick={() => play(s)}
              title={playable ? `Play from ${timestamp(s.start)}` : undefined}
              className={cn(
                "group flex w-full gap-3 px-3 py-1.5 text-left transition-colors",
                playable && "hover:bg-muted/60",
                active === i && "bg-primary/10 hover:bg-primary/15",
              )}
            >
              <span className={cn(
                "flex w-24 shrink-0 items-center gap-1 font-mono text-xs leading-5 text-muted-foreground tabular-nums",
                active === i && "text-foreground",
              )}>
                {playable && <PlayIcon className={cn("size-3 opacity-0 group-hover:opacity-100", active === i && "opacity-100")} aria-hidden />}
                {timestamp(s.start)}–{timestamp(s.end)}
              </span>
              <span className={cn(active === i && "font-medium")}>{s.text.trim()}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// 75 → "1:15", 3725 → "1:02:05"
function timestamp(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`
}

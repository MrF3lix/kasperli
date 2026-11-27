"use client"

import { useEffect, useRef, useState } from "react"
import { PencilIcon, PlayIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { speakerLabel, transcriptUrl, type TranscriptJson, type TranscriptSegment } from "@/lib/transcribe"
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
  const [speakers, setSpeakers] = useState<string[]>([])
  const [names, setNames] = useSpeakerNames(jobId, index)
  const [audioUrl, setAudioUrl] = useState<string | null | undefined>(undefined)
  const [active, setActive] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const list = useRef<HTMLOListElement>(null)

  useEffect(() => {
    let alive = true
    fetch(transcriptUrl(jobId, index, "json"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((t: TranscriptJson) => {
        if (!alive) return
        setSegments(t.segments ?? [])
        // in order of first appearance, as stt-api numbers them
        setSpeakers(t.speakers ?? [...new Set((t.segments ?? []).map((s) => s.speaker).filter((s): s is string => Boolean(s)))])
      })
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
      {speakers.length > 0 && (
        <SpeakerLegend speakers={speakers} names={names} onRename={(speaker, name) => setNames({ ...names, [speaker]: name })} />
      )}
      <ol ref={list} className="relative max-h-96 overflow-y-auto rounded-lg border text-sm">
        {segments.map((s, i) => (
          <li
            key={i}
            className={cn(
              "border-b last:border-b-0",
              s.speaker && cn("border-l-4", speakerColor(speakers, s.speaker).border),
            )}
          >
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
              <span className={cn(active === i && "font-medium")}>
                {/* the name where the speaker changes */}
                {s.speaker && s.speaker !== (segments[i - 1] as TranscriptSegment | undefined)?.speaker && (
                  <span className={cn("mr-1.5 text-xs font-semibold", speakerColor(speakers, s.speaker).text)}>
                    {names[s.speaker] || speakerLabel(s.speaker)}
                  </span>
                )}
                {s.text.trim()}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// one colour per speaker, in order of appearance (literal class names, for Tailwind)
const SPEAKER_COLORS = [
  { dot: "bg-sky-500", border: "border-l-sky-500", text: "text-sky-700 dark:text-sky-300" },
  { dot: "bg-amber-500", border: "border-l-amber-500", text: "text-amber-700 dark:text-amber-300" },
  { dot: "bg-emerald-500", border: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  { dot: "bg-violet-500", border: "border-l-violet-500", text: "text-violet-700 dark:text-violet-300" },
  { dot: "bg-rose-500", border: "border-l-rose-500", text: "text-rose-700 dark:text-rose-300" },
  { dot: "bg-teal-500", border: "border-l-teal-500", text: "text-teal-700 dark:text-teal-300" },
  { dot: "bg-orange-500", border: "border-l-orange-500", text: "text-orange-700 dark:text-orange-300" },
  { dot: "bg-fuchsia-500", border: "border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300" },
]

function speakerColor(speakers: string[], speaker: string) {
  const i = speakers.indexOf(speaker)
  return SPEAKER_COLORS[(i === -1 ? 0 : i) % SPEAKER_COLORS.length]
}

/** Names given to a transcript's speakers ("Speaker 1" -> "Interviewer"), kept in this browser. */
function useSpeakerNames(jobId: string, index: number): [Record<string, string>, (names: Record<string, string>) => void] {
  const key = `transcribe.speakers.${jobId}.${index}`
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
      if (stored && typeof stored === "object") setNames(stored)
    } catch {
      // nothing stored, or storage unavailable
    }
  }, [key])
  function save(next: Record<string, string>) {
    setNames(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // storage unavailable (private mode): the names last until the page is left
    }
  }
  return [names, save]
}

/** The speakers with their colours; clicking one renames it. */
function SpeakerLegend({ speakers, names, onRename }: {
  speakers: string[]
  names: Record<string, string>
  onRename: (speaker: string, name: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  function finish() {
    if (editing) onRename(editing, draft.trim())
    setEditing(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {speakers.map((speaker) => (
        <span key={speaker} className="flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2">
          <span className={cn("size-2 rounded-full", speakerColor(speakers, speaker).dot)} aria-hidden />
          {editing === speaker ? (
            <Input
              autoFocus
              value={draft}
              placeholder={speakerLabel(speaker)}
              aria-label={`Name of ${speakerLabel(speaker)}`}
              className="h-6 w-32 px-1.5 text-xs"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === "Enter") finish()
                if (e.key === "Escape") setEditing(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="group flex items-center gap-1 rounded-full px-1 hover:bg-muted"
              title="Rename"
              onClick={() => {
                setDraft(names[speaker] ?? "")
                setEditing(speaker)
              }}
            >
              {names[speaker] || speakerLabel(speaker)}
              <PencilIcon className="size-3 opacity-40 group-hover:opacity-100" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <span className="text-muted-foreground">Click a speaker to rename it (only in this browser; downloads keep “Speaker 1”, …).</span>
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

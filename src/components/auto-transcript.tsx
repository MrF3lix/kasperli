"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cancelTranscription, startTranscription, waitForTranscription } from "@/lib/transcription-client"

// the automatic transcription of a recording (Swiss German speech to Standard German text)
export type AutoTranscript =
  | { state: "queued"; ahead: number | null }
  | { state: "running" }
  | { state: "done"; text: string }
  | { state: "error"; message: string }

type Job = { id: string | null; finished: boolean; controller: AbortController }

/**
 * Transcribes recordings automatically: `begin` starts one (replacing the previous), `stop` drops
 * it. `onDone` gets the transcript; the state is for showing progress with AutoTranscriptStatus.
 */
export function useAutoTranscript(onDone: (text: string) => void) {
  const [auto, setAuto] = useState<AutoTranscript | null>(null)
  const job = useRef<Job | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  const stop = useCallback(() => {
    const current = job.current
    job.current = null
    setAuto(null)
    if (!current) return
    current.controller.abort()
    // queued work would take the GPU from others; finished jobs expire by themselves
    if (current.id && !current.finished) cancelTranscription(current.id)
  }, [])

  const begin = useCallback((audio: File) => {
    stop()
    const controller = new AbortController()
    const current: Job = { id: null, finished: false, controller }
    job.current = current
    setAuto({ state: "queued", ahead: null })
    const result = (async () => {
      const started = await startTranscription(audio, controller.signal)
      current.id = started.id
      return waitForTranscription(started.id, controller.signal, (update) => {
        if (job.current !== current) return
        setAuto(update.status === "running" ? { state: "running" } : { state: "queued", ahead: update.queue_position })
      })
    })()
    result.then((text) => {
      current.finished = true
      if (job.current !== current) return
      setAuto({ state: "done", text })
      onDoneRef.current(text)
    }, (e: unknown) => {
      current.finished = true
      if (job.current !== current || controller.signal.aborted) return
      setAuto({ state: "error", message: e instanceof Error ? e.message : "Automatic transcription failed." })
    })
  }, [stop])

  // stop when the page is left
  useEffect(() => stop, [stop])

  return { auto, begin, stop }
}

/** Progress and result of an automatic transcription, next to the transcript field (`text`). */
export function AutoTranscriptStatus({ auto, text, onUse }: { auto: AutoTranscript; text: string; onUse: (text: string) => void }) {
  const className = "flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
  if (auto.state === "queued" || auto.state === "running") {
    return (
      <p className={className} aria-live="polite">
        <Loader2Icon className="size-4 animate-spin" />
        {auto.state === "queued" && auto.ahead ? `Waiting to be transcribed (${auto.ahead} ahead)…` : "Transcribing automatically…"}
      </p>
    )
  }
  if (auto.state === "error") {
    return <p className="text-sm text-destructive" aria-live="polite">{auto.message}</p>
  }
  if (!auto.text) {
    return <p className={className} aria-live="polite">No speech was recognised.</p>
  }
  if (text.trim() === auto.text) {
    return (
      <p className={className} aria-live="polite">
        <SparklesIcon className="size-4" /> Transcribed automatically. Check and correct it.
      </p>
    )
  }
  // the user typed their own transcript before the automatic one was ready, or edited it
  return (
    <div className="grid gap-1.5 rounded-lg border border-dashed p-2.5 text-sm" aria-live="polite">
      <span className="flex items-center gap-1.5 text-muted-foreground"><SparklesIcon className="size-4" /> Automatic transcript</span>
      <p>{auto.text}</p>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onUse(auto.text)}>Use this instead</Button>
    </div>
  )
}

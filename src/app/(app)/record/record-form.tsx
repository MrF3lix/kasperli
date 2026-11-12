"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CheckCircle2Icon, Loader2Icon, RotateCcwIcon, SaveIcon, SparklesIcon } from "lucide-react"
import { Recorder } from "@/components/recorder"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, type Language, MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS, MAX_TRANSCRIPT_CHARS, RECORDING_MODEL_NAME } from "@/lib/tts"
import { cancelTranscription, startTranscription, waitForTranscription } from "@/lib/transcription-client"
import { toWav, type WavFile } from "@/lib/wav"
import { saveTranscript } from "../saved/[id]/actions"

// the dialect chosen last, so a series of recordings needs it only once
const DIALECT_KEY = "record.dialect"

// the automatic transcription of the current recording
type AutoTranscript =
  | { state: "queued"; ahead: number | null }
  | { state: "running" }
  | { state: "done"; text: string }
  | { state: "error"; message: string }

type TranscriptionJob = { id: string | null; finished: boolean; controller: AbortController; result: Promise<string> }

type Props = {
  dialects: Language[]
  // the signed-in user, who is the speaker
  speakerName: string
}

/** Recording, then dialect and transcript, then saving as a sample; repeats for the next one. */
export function RecordForm({ dialects, speakerName }: Props) {
  const [language, setLanguage] = useState(dialects[0].code)
  const [wav, setWav] = useState<WavFile | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  // after saving a recording whose transcript was still being made: whether it was added since
  const [savedTranscript, setSavedTranscript] = useState<"pending" | "added" | "failed" | null>(null)
  const [auto, setAuto] = useState<AutoTranscript | null>(null)
  const job = useRef<TranscriptionJob | null>(null)
  // transcriptions of saved recordings that are still being made, stopped when the page is left
  const background = useRef(new Set<AbortController>())
  // the typed transcript, for deciding whether the automatic one may fill the field
  const textRef = useRef(text)
  // the saved recording the message is about, for transcripts that are added after saving
  const savedIdRef = useRef(savedId)
  useEffect(() => {
    textRef.current = text
    savedIdRef.current = savedId
  })

  useEffect(() => {
    const running = background.current
    return () => {
      stopTranscription()
      running.forEach((c) => c.abort())
    }
  }, [])

  /** Transcribes the new recording automatically, replacing a transcription of an earlier one. */
  function beginTranscription(audio: File) {
    stopTranscription()
    const controller = new AbortController()
    const current: TranscriptionJob = { id: null, finished: false, controller, result: Promise.resolve("") }
    job.current = current
    setAuto({ state: "queued", ahead: null })
    current.result = (async () => {
      const started = await startTranscription(audio, controller.signal)
      current.id = started.id
      return waitForTranscription(started.id, controller.signal, (update) => {
        if (job.current !== current) return
        setAuto(update.status === "running" ? { state: "running" } : { state: "queued", ahead: update.queue_position })
      })
    })()
    current.result.finally(() => { current.finished = true }).catch(() => {})
    current.result.then((transcript) => {
      if (job.current !== current) return
      setAuto({ state: "done", text: transcript })
      // what the user typed meanwhile is kept
      if (!textRef.current.trim()) setText(transcript)
    }, (e: unknown) => {
      if (job.current !== current || controller.signal.aborted) return
      setAuto({ state: "error", message: e instanceof Error ? e.message : "Automatic transcription failed." })
    })
  }

  /** Stops the transcription of the current recording, e.g. when it is discarded. */
  function stopTranscription() {
    const current = job.current
    job.current = null
    setAuto(null)
    if (!current) return
    current.controller.abort()
    // queued work would take the GPU from others; finished jobs expire by themselves
    if (current.id && !current.finished) cancelTranscription(current.id)
  }

  /** A recording was saved before its transcript was ready: add the transcript to it when it is. */
  function finishInBackground(current: TranscriptionJob, sampleId: string) {
    job.current = null
    setAuto(null)
    background.current.add(current.controller)
    setSavedTranscript("pending")
    current.result
      .then(async (transcript) => {
        if (!transcript) return "failed" as const
        const result = await saveTranscript(sampleId, transcript)
        return "error" in result ? "failed" as const : "added" as const
      })
      .catch(() => "failed" as const)
      .then((outcome) => {
        background.current.delete(current.controller)
        if (!current.controller.signal.aborted && savedIdRef.current === sampleId) setSavedTranscript(outcome)
      })
  }

  function discard() {
    stopTranscription()
    setWav(null)
    setText("")
  }

  // restore the last dialect after hydrating (storage isn't available on the server)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DIALECT_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
      if (stored && dialects.some((d) => d.code === stored)) setLanguage(stored)
    } catch {
      // storage blocked: start with the first dialect
    }
  }, [dialects])

  function chooseLanguage(code: string) {
    setLanguage(code)
    try {
      localStorage.setItem(DIALECT_KEY, code)
    } catch {
      // not remembered
    }
  }

  // ask before leaving the page with a recording that isn't saved
  useEffect(() => {
    if (!wav) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [wav])

  async function recorded(blob: Blob) {
    setError(null)
    setSavedId(null)
    setSavedTranscript(null)
    setBusy(true)
    try {
      const result = await toWav(blob, "recording")
      if (result.file.size > MAX_RECORDING_BYTES) {
        setError("The recording is too large to save. Record a shorter one.")
        return
      }
      setWav(result)
      beginTranscription(result.file)
    } catch (e) {
      console.error(e)
      setError("The recording could not be read. Try again, or in another browser.")
    } finally {
      setBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!wav) return
    setError(null)
    setSaving(true)
    try {
      const body = new FormData()
      body.append("audio", wav.file)
      body.append("language", language)
      body.append("text", text)
      const response = await fetch("/api/samples/record", { method: "POST", body })
      if (!response.ok) {
        setError(await errorMessage(response))
        return
      }
      const { id } = await response.json()
      setSavedId(id)
      setSavedTranscript(null)
      const current = job.current
      const transcribing = auto?.state === "queued" || auto?.state === "running"
      if (current && transcribing && !text.trim()) {
        finishInBackground(current, id)
      } else {
        stopTranscription()
      }
      setWav(null)
      setText("")
    } catch {
      setError("Saving failed. Check your connection.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={save} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="dialect">Dialect / Language</Label>
            <NativeSelect id="dialect" className="w-full" value={language} onChange={(e) => chooseLanguage(e.target.value)}>
              {dialects.map((d) => (
                <NativeSelectOption key={d.code} value={d.code}>{d.name}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Recording</span>
            {wav ? (
              <RecordingPreview wav={wav} onDiscard={discard} disabled={saving} />
            ) : (
              <Recorder
                maxSeconds={MAX_RECORDING_SECONDS}
                busy={busy}
                onRecorded={recorded}
                onError={setError}
              />
            )}
            <p className="text-sm text-muted-foreground">
              Up to {MAX_RECORDING_SECONDS} s. Speaker: <span className="font-medium text-foreground">{speakerName}</span> · Model: {RECORDING_MODEL_NAME}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="transcript">Transcript</Label>
            <Textarea
              id="transcript"
              rows={3}
              maxLength={MAX_TRANSCRIPT_CHARS}
              value={text}
              placeholder={auto?.state === "queued" || auto?.state === "running"
                ? "Transcribing automatically… You can also type it yourself."
                : "What you said. It is transcribed automatically after recording; you can also add it later on the sample's page."}
              onChange={(e) => setText(e.target.value)}
            />
            {auto && <AutoTranscriptStatus auto={auto} text={text} onUse={setText} />}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!wav || saving}>
              <SaveIcon /> {saving ? "Saving…" : "Save recording"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
            {savedId && !error && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
                <CheckCircle2Icon className="size-4 text-primary" />
                Saved.
                <Link href={`/saved/${savedId}`} className="underline underline-offset-4 hover:text-foreground">Open it</Link>
                or
                <Link href="/saved" className="underline underline-offset-4 hover:text-foreground">see all saved samples</Link>.
                {savedTranscript === "pending" && " The transcript is added when it's ready."}
                {savedTranscript === "added" && " The automatic transcript was added."}
                {savedTranscript === "failed" && " The automatic transcription failed; add the transcript on the sample's page."}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function AutoTranscriptStatus({ auto, text, onUse }: { auto: AutoTranscript; text: string; onUse: (text: string) => void }) {
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
        <SparklesIcon className="size-4" /> Transcribed automatically (Swiss German to Standard German). Check and correct it.
      </p>
    )
  }
  // the user typed their own transcript before the automatic one was ready
  return (
    <div className="grid gap-1.5 rounded-lg border border-dashed p-2.5 text-sm" aria-live="polite">
      <span className="flex items-center gap-1.5 text-muted-foreground"><SparklesIcon className="size-4" /> Automatic transcript</span>
      <p>{auto.text}</p>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onUse(auto.text)}>Use this instead</Button>
    </div>
  )
}

function RecordingPreview({ wav, onDiscard, disabled }: { wav: WavFile; onDiscard: () => void; disabled: boolean }) {
  // object URL for the player, released when the player goes away or the recording changes
  const attach = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return
    const url = URL.createObjectURL(wav.file)
    audio.src = url
    return () => URL.revokeObjectURL(url)
  }, [wav])

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{wav.duration.toFixed(1)} s</span>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={disabled}>
          <RotateCcwIcon /> Record again
        </Button>
      </div>
      <audio controls ref={attach} className="w-full" />
    </div>
  )
}

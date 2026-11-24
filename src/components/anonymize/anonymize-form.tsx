"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { AutoTranscriptStatus, useAutoTranscript } from "@/components/auto-transcript"
import { SpeakerInput } from "@/components/generate/speaker-input"
import type { AnonymizeEntry } from "@/components/anonymize/anonymize-view"
import {
  MAX_ANONYMIZE_SEED, MAX_ANONYMIZE_TEXT_CHARS, MAX_ANONYMIZE_VARIANTS, MAX_REFERENCE_SECONDS, MAX_TARGET_SECONDS, type AnonymizeJob, type AnonymizerModel,
} from "@/lib/anonymize"
import type { Speaker } from "@/lib/speakers"
import { errorMessage } from "@/lib/tts"
import type { WavFile } from "@/lib/wav"

type Props = {
  models: AnonymizerModel[]
  // the user's saved speakers, newest first
  speakers: Speaker[]
  onSubmitted: (entry: AnonymizeEntry) => void
}

// preselected: the first model with workers, as on the Generate page
function defaultModel(models: AnonymizerModel[]): AnonymizerModel {
  return models.find((m) => m.workers !== 0) ?? models[0]
}

export function AnonymizeForm({ models, speakers, onSubmitted }: Props) {
  const router = useRouter()
  const [target, setTarget] = useState<WavFile | null>(null)
  const [reference, setReference] = useState<WavFile | null>(null)
  // a saved speaker as the reference, or "" for a new upload or recording
  const [speakerId, setSpeakerId] = useState("")
  const [modelId, setModelId] = useState(defaultModel(models).id)
  const model = models.find((m) => m.id === modelId)!
  const [language, setLanguage] = useState(model.languages[0]?.code ?? "")
  const [text, setText] = useState("")
  const [numSamples, setNumSamples] = useState(1)
  const [seed, setSeed] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The recording is transcribed as soon as it is added, so the transcript can be checked and
  // corrected before submitting. It fills the field unless the user has typed their own.
  const lastAuto = useRef("")
  const { auto, begin, stop } = useAutoTranscript((transcript) => {
    // React runs the updater later, so it compares with the previous transcript captured here
    const previous = lastAuto.current
    lastAuto.current = transcript
    setText((current) => (!current.trim() || current === previous ? transcript : current))
  })
  const transcribing = auto?.state === "queued" || auto?.state === "running"

  function changeTarget(value: WavFile | null) {
    setTarget(value)
    // a transcript filled in automatically belongs to the previous recording
    const previous = lastAuto.current
    lastAuto.current = ""
    setText((current) => (current === previous ? "" : current))
    if (value) begin(value.file)
    else stop()
  }

  function changeModel(id: string) {
    const next = models.find((m) => m.id === id)!
    setModelId(id)
    // keep the dialect if the new model has it too
    if (!next.languages.some((l) => l.code === language)) {
      setLanguage(next.languages[0]?.code ?? "")
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) {
      setError("Add the recording to anonymize first.")
      return
    }
    if (!reference && !speakerId) {
      setError("Add a reference recording of the voice first.")
      return
    }
    setError(null)
    setSubmitting(true)

    const body = new FormData()
    body.append("target_wav", target.file)
    if (modelId) body.append("model", modelId)
    body.append("language", language)
    body.append("num_samples", String(numSamples))
    if (seed.trim()) body.append("seed", seed.trim())
    if (text.trim()) body.append("text", text.trim())
    if (speakerId) {
      body.append("speaker_id", speakerId)
    } else if (reference) {
      body.append("reference_wav", reference.file)
    }
    const referenceName = speakerId
      ? speakers.find((s) => s.id === speakerId)?.name ?? "Saved speaker"
      : reference!.file.name.replace(/\.wav$/i, "")

    try {
      const response = await fetch("/api/anonymize", { method: "POST", body })
      if (response.status === 401) {
        // session expired or revoked
        router.push("/login")
      } else if (!response.ok) {
        setError(await errorMessage(response))
      } else {
        const { jobs }: { jobs: AnonymizeJob[] } = await response.json()
        onSubmitted({
          id: jobs[0].id, ids: jobs.map((j) => j.id), target: target.file.name.replace(/\.wav$/i, ""), reference: referenceName,
          initial: jobs,
        })
        // a new reference is now a saved speaker: select it, so the next job doesn't upload it again
        const savedId = response.headers.get("x-speaker-id")
        if (savedId && !speakerId) {
          setSpeakerId(savedId)
          setReference(null)
          router.refresh()
        }
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const offline = model.workers === 0
  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="model">Model</Label>
          <NativeSelect id="model" className="w-full" value={modelId} onChange={(e) => changeModel(e.target.value)}>
            {models.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}{m.workers === 0 ? " (offline)" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="language">Language</Label>
          <NativeSelect id="language" className="w-full" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {model.languages.map((l) => (
              <NativeSelectOption key={l.code} value={l.code}>{l.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={speakers.length ? "speaker" : undefined}>Voice reference</Label>
        {speakers.length > 0 && (
          <NativeSelect id="speaker" className="w-full" value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
            <NativeSelectOption value="">New reference (upload or record)</NativeSelectOption>
            {speakers.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {speakerId ? (
          <audio key={speakerId} controls preload="none" src={`/api/speakers/${speakerId}/audio`} className="w-full" />
        ) : (
          <SpeakerInput value={reference} onChange={setReference} maxSeconds={MAX_REFERENCE_SECONDS} />
        )}
      </div>

      <div className="grid gap-2">
        <Label>Recording to anonymize</Label>
        <SpeakerInput
          value={target}
          onChange={changeTarget}
          maxSeconds={MAX_TARGET_SECONDS}
          noun="recording"
          hint="Its words are kept; the voice is replaced."
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="transcript">Transcript</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{text.length} / {MAX_ANONYMIZE_TEXT_CHARS}</span>
        </div>
        <Textarea
          id="transcript"
          rows={4}
          maxLength={MAX_ANONYMIZE_TEXT_CHARS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={transcribing ? "Transcribing… You can also type it yourself." : "What is said in the recording, in Standard German"}
        />
        {auto
          ? <AutoTranscriptStatus auto={auto} text={text} onUse={setText} />
          : (
            <p className="text-sm text-muted-foreground">
              The recording is transcribed automatically once you add it; correct it here. The words of the result
              follow this transcript.
            </p>
          )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="num_samples">Variants</Label>
          <NativeSelect id="num_samples" className="w-full" value={numSamples}
                        onChange={(e) => setNumSamples(Number(e.target.value))}>
            {Array.from({ length: MAX_ANONYMIZE_VARIANTS }, (_, i) => i + 1).map((n) => (
              <NativeSelectOption key={n} value={n}>{n}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seed">Seed <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="seed" type="number" min={0} max={MAX_ANONYMIZE_SEED - numSamples + 1} step={1} inputMode="numeric"
                 value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submitting || !target || (!reference && !speakerId) || !language || (transcribing && !text.trim())}>
          {submitting ? "Submitting…" : "Anonymize"}
        </Button>
        {transcribing && !text.trim() ? (
          <span className="text-sm text-muted-foreground">Waiting for the transcript, so you can check it first.</span>
        ) : offline && (
          <span className="text-sm text-muted-foreground">No worker is running for this model; the job will wait.</span>
        )}
      </div>
    </form>
  )
}

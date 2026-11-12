"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2Icon, RotateCcwIcon, SaveIcon } from "lucide-react"
import { Recorder } from "@/components/recorder"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, type Language, MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS, MAX_TRANSCRIPT_CHARS, RECORDING_MODEL_NAME } from "@/lib/tts"
import { toWav, type WavFile } from "@/lib/wav"

// the dialect chosen last, so a series of recordings needs it only once
const DIALECT_KEY = "record.dialect"

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
    setBusy(true)
    try {
      const result = await toWav(blob, "recording")
      if (result.file.size > MAX_RECORDING_BYTES) {
        setError("The recording is too large to save. Record a shorter one.")
        return
      }
      setWav(result)
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
              <RecordingPreview wav={wav} onDiscard={() => setWav(null)} disabled={saving} />
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
              placeholder="What you said. You can also add it later on the sample's page."
              onChange={(e) => setText(e.target.value)}
            />
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
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
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

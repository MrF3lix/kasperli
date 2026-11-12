"use client"

import { useState, useTransition } from "react"
import { AutosaveStatus } from "@/components/autosave-status"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/hooks/use-autosave"
import { type Language, MAX_TRANSCRIPT_CHARS } from "@/lib/tts"
import { saveRecordingDialect, saveTranscript } from "./actions"

/** What is said in a recording, typed by the user; saved automatically like notes. */
export function TranscriptField({ id, initial }: { id: string; initial: string }) {
  const text = useAutosave(initial, async (value) => {
    const result = await saveTranscript(id, value)
    return "error" in result ? result : { value: result.text }
  })

  return (
    <div className="grid gap-1">
      <Textarea
        id="transcript"
        aria-label="Transcript"
        rows={2}
        maxLength={MAX_TRANSCRIPT_CHARS}
        value={text.value}
        placeholder="What is said in the recording"
        className="text-base"
        onChange={(e) => text.change(e.target.value)}
        onBlur={text.flush}
      />
      <AutosaveStatus status={text.status} />
    </div>
  )
}

/** The dialect of a recording, saved when another one is chosen. */
export function DialectSelect({ id, initial, dialects }: { id: string; initial: string; dialects: Language[] }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // a code the gateway no longer lists stays selectable
  const options = dialects.some((d) => d.code === initial) ? dialects : [{ code: initial, name: initial }, ...dialects]

  function change(code: string) {
    const previous = value
    setValue(code)
    setError(null)
    startTransition(async () => {
      const result = await saveRecordingDialect(id, code)
      if ("error" in result) {
        setValue(previous)
        setError(result.error)
      }
    })
  }

  return (
    <span className="grid gap-1">
      <NativeSelect size="sm" aria-label="Dialect" value={value} disabled={pending} onChange={(e) => change(e.target.value)}>
        {options.map((d) => <NativeSelectOption key={d.code} value={d.code}>{d.name}</NativeSelectOption>)}
      </NativeSelect>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

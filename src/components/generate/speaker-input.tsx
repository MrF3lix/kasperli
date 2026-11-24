"use client"

import { useCallback, useState } from "react"
import { XIcon } from "lucide-react"
import { Recorder } from "@/components/recorder"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { MAX_SPEAKER_SECONDS } from "@/lib/tts"
import { toWav, type WavFile } from "@/lib/wav"

type Props = {
  value: WavFile | null
  onChange: (value: WavFile | null) => void
  // longest recording accepted
  maxSeconds?: number
  // shown under the upload and recording tabs
  hint?: string
  // what the recording is, for the remove button's label
  noun?: string
}

/**
 * The reference recording of the voice to clone: an uploaded file or a microphone recording.
 * Also used for other recordings, such as the one to anonymize.
 */
export function SpeakerInput({
  value, onChange, maxSeconds = MAX_SPEAKER_SECONDS, hint = "5–15 seconds of clean speech without background noise work best.",
  noun = "reference",
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function accept(blob: Blob, name: string) {
    setError(null)
    setBusy(true)
    try {
      const wav = await toWav(blob, name)
      if (wav.duration > maxSeconds) {
        setError(`The ${noun} is ${Math.round(wav.duration)} s long; at most ${maxSeconds} s are allowed. Trim it first.`)
        return
      }
      onChange(wav)
    } catch (e) {
      console.log(e)
      setError("This file could not be read as audio. Compressed WAVs (ADPCM, GSM) aren't supported; export it as an uncompressed WAV, FLAC or MP3.")
    } finally {
      setBusy(false)
    }
  }

  // dropping a file anywhere on the reference area picks it, also replacing a chosen one
  const [dragging, setDragging] = useState(false)
  const dropZone = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      // leaving for a child element still counts as inside
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file || busy) return
      if (file.type && !file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        setError(`${file.name} is not an audio file.`)
        return
      }
      void accept(file, file.name.replace(/\.[^.]*$/, ""))
    },
  }

  if (value) {
    return (
      <div {...dropZone} className={dragging ? "rounded-lg ring-2 ring-ring" : undefined}>
        <SelectedSpeaker value={value} noun={noun} onClear={() => onChange(null)} />
      </div>
    )
  }

  return (
    <div className="grid gap-2" {...dropZone}>
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="record">Record</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <label className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm hover:bg-muted/50",
            dragging && "border-ring bg-muted/50",
          )}>
            <span className="font-medium">
              {busy ? "Reading…" : dragging ? "Drop to use this file" : "Drop an audio file here or click to choose one"}
            </span>
            <span className="text-muted-foreground">WAV, MP3, M4A, … up to {maxSeconds} s</span>
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (file) void accept(file, file.name.replace(/\.[^.]*$/, ""))
              }}
            />
          </label>
        </TabsContent>
        <TabsContent value="record">
          <Recorder maxSeconds={maxSeconds} busy={busy} onRecorded={(blob) => accept(blob, `Recording ${new Date().toLocaleString()}`)} onError={setError} />
        </TabsContent>
      </Tabs>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function SelectedSpeaker({ value, noun, onClear }: { value: WavFile; noun: string; onClear: () => void }) {
  // object URL for the preview player, released when the player goes away or the file changes
  const attach = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return
    const url = URL.createObjectURL(value.file)
    audio.src = url
    return () => URL.revokeObjectURL(url)
  }, [value])

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{value.file.name}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">{value.duration.toFixed(1)} s</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} aria-label={`Remove ${noun}`}>
            <XIcon />
          </Button>
        </div>
      </div>
      <audio controls ref={attach} className="w-full" />
    </div>
  )
}

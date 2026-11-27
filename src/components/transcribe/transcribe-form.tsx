"use client"

import { useRef, useState, type DragEvent, type FormEvent } from "react"
import { UploadIcon, XIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Progress } from "@/components/ui/progress"
import { MAX_TRANSCRIBE_BYTES, MAX_TRANSCRIBE_FILES, type TranscribeJob } from "@/lib/transcribe"
import { saveJobAudio } from "@/lib/transcribe-audio"
import { appendOptions, initialOptions, SegmentFields, SpeakerFields, type OptionsState } from "@/components/transcribe/transcribe-options"
import type { SttModel } from "@/lib/transcription-client"
import { cn } from "@/lib/utils"

// what the gateway reads (soundfile): WAV, FLAC, OGG, MP3
const ACCEPT = "audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/ogg,audio/mpeg,.wav,.flac,.ogg,.oga,.mp3"
// value of the language picker for detection
const AUTO = ""

type Props = {
  models: SttModel[]
  onSubmitted: (job: TranscribeJob) => void
}

function defaultModel(models: SttModel[]): SttModel {
  return models.find((m) => m.id === "whisper-swiss-german" && m.workers > 0) ?? models.find((m) => m.workers > 0) ?? models[0]
}

/** Audio files and the transcription options; submits one job for all files. */
export function TranscribeForm({ models, onSubmitted }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [modelId, setModelId] = useState(() => defaultModel(models).id)
  const model = models.find((m) => m.id === modelId) ?? models[0]
  const [language, setLanguage] = useState(model.default_language ?? AUTO)
  const [timestamps, setTimestamps] = useState(true)
  const [options, setOptions] = useState<OptionsState>(() => initialOptions(model))
  // speakers are assigned per word, so they need timestamps
  const withTimestamps = model.timestamps && (timestamps || Boolean(options.diarization))
  const [dragging, setDragging] = useState(false)
  // upload progress 0..1 while submitting
  const [upload, setUpload] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const tooMany = files.length > MAX_TRANSCRIBE_FILES
  const tooLarge = totalBytes > MAX_TRANSCRIBE_BYTES

  function changeModel(id: string) {
    const next = models.find((m) => m.id === id)
    if (!next) return
    setModelId(id)
    // keep the language if the new model has it
    if (!next.languages.some((l) => l.code === language) || (language === AUTO && next.default_language)) {
      setLanguage(next.default_language ?? AUTO)
    }
    // keep the speaker detection if the new model offers it too
    if (options.diarization && !next.diarizers.some((d) => d.id === options.diarization)) {
      setOptions({ ...options, diarization: "" })
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const added = [...list].filter((f) => f.size > 0)
    setFiles((current) => [...current, ...added.filter((f) => !current.some((c) => c.name === f.name && c.size === f.size))])
    setError(null)
  }

  function drop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!files.length || tooMany || tooLarge || upload !== null) return
    const body = new FormData()
    files.forEach((f) => body.append("audio", f, f.name))
    body.append("model", model.id)
    if (language) body.append("language", language)
    if (withTimestamps) body.append("timestamps", "true")
    appendOptions(body, options, model)

    // XMLHttpRequest for the upload progress, which fetch doesn't report
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/stt/jobs")
    xhr.responseType = "json"
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setUpload(ev.loaded / ev.total)
    xhr.onload = () => {
      setUpload(null)
      if (xhr.status === 202 && xhr.response?.id) {
        const job = xhr.response as TranscribeJob
        // for playing the segments; the gateway doesn't keep the audio
        void saveJobAudio(job.id, files)
        setFiles([])
        if (input.current) input.current.value = ""
        onSubmitted(job)
      } else {
        setError(detail(xhr.response) ?? `The upload failed (${xhr.status}).`)
      }
    }
    xhr.onerror = () => {
      setUpload(null)
      setError("The upload failed. Check the connection and try again.")
    }
    setError(null)
    setUpload(0)
    xhr.send(body)
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="audio">Audio files</Label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          onClick={() => input.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-muted/60",
          )}
        >
          <UploadIcon className="size-5" aria-hidden />
          <span><span className="font-medium text-foreground">Choose files</span> or drop them here</span>
          <span className="text-xs">WAV, FLAC, OGG or MP3 · up to {MAX_TRANSCRIBE_FILES} files of at most 30 minutes each</span>
        </div>
        <input
          ref={input}
          id="audio"
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => { addFiles(e.target.files); e.target.value = "" }}
        />
        {files.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{megabytes(f.size)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${f.name}`}
                  disabled={upload !== null}
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {tooMany && <p className="text-sm text-destructive">At most {MAX_TRANSCRIBE_FILES} files per transcription.</p>}
        {tooLarge && <p className="text-sm text-destructive">The files are too large together. Compress them (e.g. FLAC or MP3) or send fewer at once.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="model">Model</Label>
          <NativeSelect id="model" className="w-full" value={model.id} onChange={(e) => changeModel(e.target.value)}>
            {models.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.name}{m.workers === 0 ? " (no workers)" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {model.id === "whisper-swiss-german"
              ? "Swiss German speech, written as Standard German."
              : model.default_language
                ? `Speech in ${model.languages.find((l) => l.code === model.default_language)?.name ?? model.default_language}.`
                : `${model.languages.length} languages, detected automatically unless you choose one.`}
            {model.workers === 0 && " No worker is running, so the transcription waits until one starts."}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="language">Language</Label>
          <NativeSelect
            id="language"
            className="w-full"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={model.languages.length <= 1 && model.default_language !== null}
          >
            {!model.default_language && <NativeSelectOption value={AUTO}>Detect automatically</NativeSelectOption>}
            {[...model.languages].sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
              <NativeSelectOption key={l.code} value={l.code}>{l.name}</NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {language === AUTO ? "Detected from the first 30 seconds of each file. Choosing it is faster and more reliable." : "The language spoken in the recordings."}
          </p>
        </div>
      </div>

      <label className={cn("flex items-start gap-2.5 text-sm", !model.timestamps && "opacity-50")}>
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={withTimestamps}
          disabled={!model.timestamps || Boolean(options.diarization)}
          onChange={(e) => setTimestamps(e.target.checked)}
        />
        <span className="grid gap-0.5">
          <span className="font-medium">Timestamps</span>
          <span className="text-xs text-muted-foreground">
            {!model.timestamps
              ? "This model has no timestamps."
              : options.diarization
                ? "Needed to identify speakers."
                : "Timed segments, and subtitles to download as SRT or VTT."}
          </span>
        </span>
      </label>

      <SpeakerFields model={model} options={options} onChange={setOptions} disabled={upload !== null} />
      {model.timestamps && (
        <SegmentFields model={model} options={options} onChange={setOptions} timestamps={withTimestamps} disabled={upload !== null} />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!files.length || tooMany || tooLarge || upload !== null}>
          {upload !== null
            ? "Uploading…"
            : files.length > 1 ? `Transcribe ${files.length} files` : "Transcribe"}
        </Button>
        {upload !== null && (
          <div className="flex min-w-40 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <Progress value={Math.round(upload * 100)} className="flex-1" />
            <span className="tabular-nums">{Math.round(upload * 100)} %</span>
          </div>
        )}
        {upload === null && files.length > 0 && (
          <span className="text-xs text-muted-foreground">{megabytes(totalBytes)} in total</span>
        )}
      </div>
    </form>
  )
}

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// the gateway's message: {"detail": "..."} or a list of field errors
function detail(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail
  if (typeof d === "string") return d
  if (Array.isArray(d)) return d.map((x) => `${x?.loc?.at?.(-1) ?? "input"}: ${x?.msg}`).join("; ")
  return null
}

"use client"

import { ChevronRightIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { MAX_SPEAKERS, PIECE_SECONDS, SEGMENT_LIMITS, type SegmentOptions } from "@/lib/transcribe"
import type { SttModel } from "@/lib/transcription-client"

// The speaker diarization and segmentation options of a transcription (stt-api's POST /jobs).

export type SpeakerMode = "auto" | "exact" | "range"

export type OptionsState = {
  // a diarizer id from the model's /models entry; "": no speaker detection
  diarization: string
  speakerMode: SpeakerMode
  numSpeakers: number
  minSpeakers: number
  maxSpeakers: number
  segments: SegmentOptions
  // transcribe in pieces of at most this many seconds
  pieceSeconds: number
}

// stt-api's defaults, for gateways that don't report a model's segmentation
const FALLBACK_SEGMENTS: SegmentOptions = { max_chars: 84, max_seconds: 6, pause_seconds: 0.5, min_seconds: 1, split_on_comma: true }

export function defaultSegments(model: SttModel): SegmentOptions {
  return { ...FALLBACK_SEGMENTS, ...model.segmentation }
}

export function initialOptions(model: SttModel): OptionsState {
  return {
    diarization: "",
    speakerMode: "auto",
    numSpeakers: 2,
    minSpeakers: 1,
    maxSpeakers: 4,
    segments: defaultSegments(model),
    pieceSeconds: PIECE_SECONDS.max,
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Adds the options to a job's form data: speaker fields only with diarization, segment fields only where they differ from the model's defaults. */
export function appendOptions(body: FormData, options: OptionsState, model: SttModel) {
  if (options.diarization && model.diarizers.some((d) => d.id === options.diarization)) {
    body.append("diarization", options.diarization)
    if (options.speakerMode === "exact") {
      body.append("num_speakers", String(clamp(options.numSpeakers, 1, MAX_SPEAKERS)))
    } else if (options.speakerMode === "range") {
      const min = clamp(options.minSpeakers, 1, MAX_SPEAKERS)
      body.append("min_speakers", String(min))
      body.append("max_speakers", String(clamp(options.maxSpeakers, min, MAX_SPEAKERS)))
    }
  }
  const defaults = defaultSegments(model)
  for (const [key, limits] of Object.entries(SEGMENT_LIMITS) as [keyof typeof SEGMENT_LIMITS, (typeof SEGMENT_LIMITS)[keyof typeof SEGMENT_LIMITS]][]) {
    const value = options.segments[key]
    if (Number.isFinite(value) && value !== defaults[key]) body.append(key, String(clamp(value, limits.min, limits.max)))
  }
  if (options.segments.split_on_comma !== defaults.split_on_comma) body.append("split_on_comma", String(options.segments.split_on_comma))
  if (options.pieceSeconds < PIECE_SECONDS.max) {
    body.append("piece_seconds", String(clamp(options.pieceSeconds, PIECE_SECONDS.min, PIECE_SECONDS.max)))
  }
}

type Props = {
  model: SttModel
  options: OptionsState
  onChange: (options: OptionsState) => void
  // whether the job will have timestamps (segments only exist with them)
  timestamps: boolean
  disabled?: boolean
}

/** Speaker detection, shown when the model's workers offer it. */
export function SpeakerFields({ model, options, onChange, disabled }: Omit<Props, "timestamps">) {
  if (!model.diarizers.length) return null
  const set = (change: Partial<OptionsState>) => onChange({ ...options, ...change })
  const on = Boolean(options.diarization)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="diarization">Speakers</Label>
        <NativeSelect
          id="diarization"
          className="w-full"
          value={options.diarization}
          disabled={disabled}
          onChange={(e) => set({ diarization: e.target.value })}
        >
          <NativeSelectOption value="">Don&apos;t identify speakers</NativeSelectOption>
          {model.diarizers.map((d) => <NativeSelectOption key={d.id} value={d.id}>Identify with {d.name}</NativeSelectOption>)}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {on
            ? "Each segment gets a speaker, and segments end where the speaker changes. Turns timestamps on."
            : "Label who speaks when, e.g. for interviews or meetings."}
        </p>
      </div>
      {on && (
        <div className="grid content-start gap-2">
          <Label htmlFor="speaker-mode">Number of speakers</Label>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              id="speaker-mode"
              value={options.speakerMode}
              disabled={disabled}
              onChange={(e) => set({ speakerMode: e.target.value as SpeakerMode })}
            >
              <NativeSelectOption value="auto">Detect automatically</NativeSelectOption>
              <NativeSelectOption value="exact">Exactly</NativeSelectOption>
              <NativeSelectOption value="range">Between</NativeSelectOption>
            </NativeSelect>
            {options.speakerMode === "exact" && (
              <NumberInput label="Number of speakers" value={options.numSpeakers} min={1} max={MAX_SPEAKERS} step={1}
                disabled={disabled} onChange={(v) => set({ numSpeakers: v })} />
            )}
            {options.speakerMode === "range" && (
              <>
                <NumberInput label="At least" value={options.minSpeakers} min={1} max={MAX_SPEAKERS} step={1}
                  disabled={disabled} onChange={(v) => set({ minSpeakers: v })} />
                <span className="text-sm text-muted-foreground">and</span>
                <NumberInput label="At most" value={options.maxSpeakers} min={options.minSpeakers} max={MAX_SPEAKERS} step={1}
                  disabled={disabled} onChange={(v) => set({ maxSpeakers: v })} />
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Knowing how many people speak makes the result noticeably more reliable.
          </p>
        </div>
      )}
    </div>
  )
}

const SEGMENT_FIELDS: { key: keyof typeof SEGMENT_LIMITS; label: string; unit: string; hint: string }[] = [
  { key: "max_chars", label: "Max. characters", unit: "chars", hint: "84 fit two subtitle lines" },
  { key: "max_seconds", label: "Max. duration", unit: "s", hint: "per segment" },
  { key: "pause_seconds", label: "Pause", unit: "s", hint: "a longer pause ends a segment" },
  { key: "min_seconds", label: "Min. duration", unit: "s", hint: "shorter ones join the previous" },
]

/** How segments are formed, folded away by default. */
export function SegmentFields({ model, options, onChange, timestamps, disabled }: Props) {
  const defaults = defaultSegments(model)
  const set = (change: Partial<OptionsState>) => onChange({ ...options, ...change })
  const setSegment = (change: Partial<SegmentOptions>) => set({ segments: { ...options.segments, ...change } })
  const changed = (Object.keys(defaults) as (keyof SegmentOptions)[]).filter((k) => options.segments[k] !== defaults[k]).length
    + (options.pieceSeconds < PIECE_SECONDS.max ? 1 : 0)

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        Segment options
        <span className="font-normal text-muted-foreground">
          {changed ? `· ${changed} changed` : "· defaults"}
        </span>
      </summary>
      <div className="grid gap-4 border-t px-3 py-3">
        {!timestamps && (
          <p className="text-xs text-muted-foreground">Segments only exist with timestamps; these apply once they are on.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENT_FIELDS.map(({ key, label, unit, hint }) => {
            const limits = SEGMENT_LIMITS[key]
            return (
              <div key={key} className="grid content-start gap-1.5">
                <Label htmlFor={`segment-${key}`}>{label}</Label>
                <div className="flex items-center gap-2">
                  <NumberInput id={`segment-${key}`} label={label} value={options.segments[key]} {...limits}
                    disabled={disabled} onChange={(v) => setSegment({ [key]: v })} />
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </div>
                <p className="text-xs text-muted-foreground">{hint} (default {defaults[key]})</p>
              </div>
            )
          })}
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={options.segments.split_on_comma}
            disabled={disabled}
            onChange={(e) => setSegment({ split_on_comma: e.target.checked })}
          />
          <span className="grid gap-0.5">
            <span className="font-medium">Split at commas</span>
            <span className="text-xs text-muted-foreground">End a segment after a comma once it is half full. Sentence ends always end one.</span>
          </span>
        </label>
        <div className="grid gap-1.5 border-t pt-3 sm:max-w-sm">
          <Label htmlFor="piece-seconds">Transcription piece length</Label>
          <div className="flex items-center gap-3">
            <input
              id="piece-seconds"
              type="range"
              className="flex-1 accent-primary"
              min={PIECE_SECONDS.min}
              max={PIECE_SECONDS.max}
              step={1}
              value={options.pieceSeconds}
              disabled={disabled}
              onChange={(e) => set({ pieceSeconds: Number(e.target.value) })}
            />
            <span className="w-10 text-right text-sm tabular-nums">{options.pieceSeconds} s</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The recording is transcribed in pieces of at most this length, cut at pauses. Shorter pieces help when
            several people talk (the model tends to skip speech after a change of voice), longer ones give it more
            context. With speaker identification, pieces are also cut where the speaker changes.
          </p>
        </div>
        {changed > 0 && (
          <div>
            <Button type="button" variant="ghost" size="sm" disabled={disabled}
              onClick={() => set({ segments: defaults, pieceSeconds: PIECE_SECONDS.max })}>
              <RotateCcwIcon />Reset to defaults
            </Button>
          </div>
        )}
      </div>
    </details>
  )
}

function NumberInput({ id, label, value, min, max, step, disabled, onChange }: {
  id?: string
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <Input
      id={id}
      type="number"
      aria-label={label}
      className="w-20 tabular-nums"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      // back into range when leaving the field
      onBlur={() => onChange(Number.isFinite(value) ? clamp(value, min, max) : min)}
    />
  )
}

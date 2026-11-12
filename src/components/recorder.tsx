"use client"

import { useEffect, useRef, useState } from "react"
import { MicIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Records from the microphone, without the browser's noise suppression and gain control (they
 * change the voice), and stops by itself after `maxSeconds`.
 */
export function Recorder({ maxSeconds, busy, onRecorded, onError, className }: {
  maxSeconds: number
  busy: boolean
  onRecorded: (blob: Blob) => void
  onError: (message: string) => void
  className?: string
}) {
  const [seconds, setSeconds] = useState<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)

  // stop the microphone when the component goes away mid-recording
  useEffect(() => () => recorder.current?.stop(), [])

  useEffect(() => {
    if (seconds === null) return
    if (seconds >= maxSeconds) {
      recorder.current?.stop()
      return
    }
    const timer = setTimeout(() => setSeconds(seconds + 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds, maxSeconds])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError("Recording needs a secure connection (HTTPS) and a browser with microphone access.")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch {
      onError("No access to the microphone. Allow it in the browser and try again.")
      return
    }
    const chunks: Blob[] = []
    const mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      setSeconds(null)
      if (chunks.length) onRecorded(new Blob(chunks, { type: mediaRecorder.mimeType }))
    }
    mediaRecorder.start()
    recorder.current = mediaRecorder
    setSeconds(0)
  }

  const recording = seconds !== null
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm", className)}>
      {recording ? (
        <>
          <span className="flex items-center gap-2 font-medium">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            Recording {seconds} s / {maxSeconds} s
          </span>
          <Button type="button" variant="outline" onClick={() => recorder.current?.stop()}>
            <SquareIcon /> Stop
          </Button>
        </>
      ) : (
        <Button type="button" variant="outline" disabled={busy} onClick={start}>
          <MicIcon /> {busy ? "Processing…" : "Start recording"}
        </Button>
      )}
    </div>
  )
}

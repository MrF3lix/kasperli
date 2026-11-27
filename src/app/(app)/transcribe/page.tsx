import { Suspense } from "react"
import type { Metadata } from "next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { TranscribeView } from "@/components/transcribe/transcribe-view"
import { getCurrentUser } from "@/lib/auth"
import { getSttModels } from "@/lib/stt"

export const metadata: Metadata = {
  title: "Transcribe · TTS",
}

export default function TranscribePage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Transcribe audio</h1>
        <p className="text-sm text-muted-foreground">
          Upload recordings and get their transcripts as text or, with timestamps, as subtitles.
          Swiss German is written as Standard German.
        </p>
      </div>
      <Suspense fallback={<Card className="h-96 animate-pulse" />}>
        <Transcribe />
      </Suspense>
    </div>
  )
}

async function Transcribe() {
  const [user, models] = await Promise.all([getCurrentUser(), getSttModels()])
  if (!models?.length) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Transcription is unavailable</AlertTitle>
        <AlertDescription>
          {models === null
            ? "The transcription service is not set up or not reachable."
            : "No transcription model has started yet."} Try again later.
        </AlertDescription>
      </Alert>
    )
  }
  return <TranscribeView models={models} userId={user.id} />
}

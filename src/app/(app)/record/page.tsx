import { Suspense } from "react"
import type { Metadata } from "next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { getCurrentUser, requireToken } from "@/lib/auth"
import { getModels } from "@/lib/gateway"
import { getSttModels } from "@/lib/stt"
import { allDialects } from "@/lib/tts"
import { RecordForm } from "./record-form"

export const metadata: Metadata = {
  title: "Record · TTS",
}

export default function RecordPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Record a sample</h1>
        <p className="text-sm text-muted-foreground">
          Record yourself, choose the dialect and add what you said. The recording is saved with your
          other samples, where you can annotate it and add it to datasets.
        </p>
      </div>
      <Suspense fallback={<Card className="h-96 animate-pulse" />}>
        <Record />
      </Suspense>
    </div>
  )
}

async function Record() {
  const [user, models, sttModels] = await Promise.all([getCurrentUser(), getModels(await requireToken()), getSttModels()])
  // the dialects are those of the models
  const dialects = "error" in models ? [] : allDialects(models)
  if (!dialects.length) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Recording is unavailable</AlertTitle>
        <AlertDescription>
          {"error" in models ? `The list of dialects could not be loaded: ${models.error}` : "No model has started yet, so there are no dialects to choose from."} Try again later.
        </AlertDescription>
      </Alert>
    )
  }
  return <RecordForm dialects={dialects} speakerName={user.name} sttModels={sttModels ?? []} />
}

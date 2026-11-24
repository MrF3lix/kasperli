import { Suspense } from "react"
import type { Metadata } from "next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { AnonymizeView } from "@/components/anonymize/anonymize-view"
import { getCurrentUser, requireToken } from "@/lib/auth"
import { getAnonymizerModels } from "@/lib/anonymizer"
import { listSpeakersForForm } from "@/lib/speakers"

export const metadata: Metadata = {
  title: "Anonymize · TTS",
}

export default function AnonymizePage() {
  return (
    <div className="mx-auto grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Anonymize a recording</h1>
        <p className="text-sm text-muted-foreground">
          The words of a recording are spoken again in the voice of a reference recording, in the dialect you choose.
        </p>
      </div>
      <Suspense fallback={<Card className="h-[32rem] animate-pulse" />}>
        <Anonymize />
      </Suspense>
    </div>
  )
}

async function Anonymize() {
  const user = await getCurrentUser()
  const [models, { speakers, error: speakersError }] = await Promise.all([getAnonymizerModels(await requireToken()), listSpeakersForForm()])
  if ("error" in models) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Anonymization is unavailable</AlertTitle>
        <AlertDescription>{models.error} Try again later.</AlertDescription>
      </Alert>
    )
  }
  return (
    <>
      {speakersError && (
        <Alert>
          <AlertDescription>{speakersError}</AlertDescription>
        </Alert>
      )}
      <AnonymizeView models={models} speakers={speakers} userId={user.id} />
    </>
  )
}

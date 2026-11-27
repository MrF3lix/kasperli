import { Suspense } from "react"
import type { Metadata } from "next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { ConversationView } from "@/components/conversation/conversation-view"
import { requireToken } from "@/lib/auth"
import { speechToSpeechStatus } from "@/lib/service-status"

export const metadata: Metadata = {
  title: "Conversation · TTS",
}

export default function ConversationPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Talk to the assistant</h1>
        <p className="text-sm text-muted-foreground">
          Speak Swiss German: your speech is transcribed, a language model answers, and the answer
          is spoken back with the XTTS voice.
        </p>
      </div>
      <Suspense fallback={<Card className="h-96 animate-pulse" />}>
        <Conversation />
      </Suspense>
    </div>
  )
}

async function Conversation() {
  await requireToken()
  const status = await speechToSpeechStatus()
  if (status === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Conversations are unavailable</AlertTitle>
        <AlertDescription>The speech-to-speech service is not set up for this app.</AlertDescription>
      </Alert>
    )
  }
  const down = "error" in status ? status.error : status.health.status !== "ok" ? `It reported status "${status.health.status}".` : null
  return (
    <>
      {down && (
        <Alert variant="destructive">
          <AlertTitle>The speech-to-speech service is down</AlertTitle>
          <AlertDescription>{down} Starting a conversation will likely fail.</AlertDescription>
        </Alert>
      )}
      <ConversationView />
    </>
  )
}

import { verifiedToken } from "@/lib/gateway"
import { anonymizerStatus, sttStatus, ttsStatus, type ServiceStatus } from "@/lib/service-status"

export type StatusSummary = { services: { name: string; up: boolean }[] }

function isUp(status: ServiceStatus): boolean {
  return !("error" in status) && status.health.status === "ok"
}

// whether each configured service answers, for the dot in the header (details: the Status page)
export async function GET() {
  const token = await verifiedToken()
  if (!token) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const [tts, stt, anonymizer] = await Promise.all([ttsStatus(token), sttStatus(), anonymizerStatus()])
  const services = [
    { name: "Speech synthesis", status: tts },
    { name: "Transcription", status: stt },
    { name: "Anonymization", status: anonymizer },
  ].flatMap(({ name, status }) => (status ? [{ name, up: isUp(status) }] : []))
  return Response.json({ services } satisfies StatusSummary, { headers: { "cache-control": "no-store" } })
}

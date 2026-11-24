import "server-only"
import { fetchGateway } from "@/lib/gateway"
import type { Health } from "@/lib/tts"

// Health of the backend services for the Status page. The TTS, STT and anonymizer gateways all
// have GET /health and GET /models; /health has live workers and queued jobs per model id
// (the anonymizer gives plain totals, which are counted for its model), /models the names.

export type ServiceStatus = {
  checkedAt: number
  // model display names by id, where /models could be read
  names: Record<string, string>
} & ({ health: Health; latencyMs: number } | { error: string })

type Fetcher = (path: string) => Promise<Response>

const TIMEOUT_MS = 10_000

async function check(label: string, get: Fetcher): Promise<ServiceStatus> {
  const start = performance.now()
  const [health, models] = await Promise.allSettled([get("/health"), get("/models")])

  // display names are a nicety; the ids from /health are enough without them
  let names: Record<string, string> = {}
  let modelIds: string[] = []
  if (models.status === "fulfilled" && models.value.ok) {
    try {
      const list = await models.value.json()
      if (Array.isArray(list)) {
        modelIds = list.map((m) => m?.id).filter((id): id is string => typeof id === "string")
        names = Object.fromEntries(list.filter((m) => typeof m?.id === "string" && typeof m?.name === "string").map((m) => [m.id, m.name]))
      }
    } catch {
      // not JSON
    }
  }

  if (health.status === "rejected") {
    console.error(`${label} health check failed`, health.reason)
    return { error: `The ${label} is not reachable.`, names, checkedAt: Date.now() }
  }
  if (!health.value.ok) {
    return { error: `The ${label} answered with ${health.value.status}.`, names, checkedAt: Date.now() }
  }
  try {
    const raw = await health.value.json()
    const latencyMs = Math.round(performance.now() - start)
    return { health: normalize(raw, modelIds), latencyMs, names, checkedAt: Date.now() }
  } catch {
    return { error: `The ${label} sent an unreadable answer.`, names, checkedAt: Date.now() }
  }
}

// totals (a number instead of counts per model) belong to the service's only model
function normalize(raw: { status?: unknown; workers?: unknown; queued?: unknown }, modelIds: string[]): Health {
  const perModel = (value: unknown): Record<string, number> | undefined => {
    if (typeof value === "number") return { [modelIds[0] ?? "default"]: value }
    if (value && typeof value === "object") return value as Record<string, number>
    return undefined
  }
  return {
    status: typeof raw.status === "string" ? raw.status : "unknown",
    workers: perModel(raw.workers) ?? {},
    queued: perModel(raw.queued),
  }
}

/** A fetcher for a service without authentication, or null if its URL isn't set. */
function plain(base: string | undefined): Fetcher | null {
  if (!base) return null
  return (path) => fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) })
}

export function ttsStatus(token: string): Promise<ServiceStatus> {
  return check("TTS service", (path) => fetchGateway(token, path))
}

/** null when the service isn't set up (no URL). */
export async function sttStatus(): Promise<ServiceStatus | null> {
  const get = plain(process.env.STT_API_URL)
  return get && check("transcription service", get)
}

/** null when the service isn't set up (no URL). */
export async function anonymizerStatus(): Promise<ServiceStatus | null> {
  const get = plain(process.env.ANONYMIZER_URL)
  return get && check("anonymizer", get)
}

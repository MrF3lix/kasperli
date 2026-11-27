import { Suspense } from "react"
import type { Metadata } from "next"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { requireToken } from "@/lib/auth"
import { anonymizerStatus, realtimeTtsStatus, speechToSpeechStatus, sttStatus, ttsStatus, type ServiceStatus } from "@/lib/service-status"
import { cn } from "@/lib/utils"
import { AutoRefresh } from "./auto-refresh"

export const metadata: Metadata = {
  title: "Status · TTS",
}

export default function StatusPage() {
  return (
    <div className="mx-auto grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Status</h1>
        <p className="text-sm text-muted-foreground">
          Health of the speech synthesis, transcription, anonymization and realtime services, and the workers running for each model.
        </p>
      </div>
      <Suspense fallback={<Card className="h-64 animate-pulse" />}>
        <Status />
      </Suspense>
    </div>
  )
}

async function Status() {
  const token = await requireToken()
  const [tts, stt, anonymizer, realtimeTts, speechToSpeech] = await Promise.all([
    ttsStatus(token), sttStatus(), anonymizerStatus(), realtimeTtsStatus(), speechToSpeechStatus(),
  ])
  const checkedAt = Math.min(...[tts, stt, anonymizer, realtimeTts, speechToSpeech].filter((s) => s !== null).map((s) => s.checkedAt))

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <AutoRefresh checkedAt={checkedAt} />
      </div>
      {/* two tiles per row on wider screens, one on phones */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <Service title="Speech synthesis" name="Text-to-Speech service" status={tts} unit={["sample", "samples"]} />
        <Service title="Transcription" name="Speech-to-Text service" status={stt} unit={["job", "jobs"]} />
        <Service title="Anonymization" name="Anonymizer" status={anonymizer} unit={["job", "jobs"]} />
        <Service title="Realtime speech synthesis" name="Streaming Text-to-Speech" status={realtimeTts} />
        <Service title="Realtime Speech-to-speech" name="Speech-to-Speech service" status={speechToSpeech} />
      </div>
    </div>
  )
}

/** One service as a tile: whether it answers, and its workers and queue per model (if it has models). */
function Service({ title, name, status, unit }: {
  title: string
  name: string
  // null: not set up
  status: ServiceStatus | null
  // what its queue holds, singular and plural; without it the service has no models or queue
  unit?: [string, string]
}) {
  const up = status !== null && !("error" in status) && status.health.status === "ok"
  const health = status && !("error" in status) && unit ? status.health : null
  const workers = health ? Object.entries(health.workers).sort(([a], [b]) => a.localeCompare(b)) : []
  const total = workers.reduce((sum, [, n]) => sum + n, 0)
  const queued = health?.queued
  const totalQueued = Object.values(queued ?? {}).reduce((sum, n) => sum + n, 0)
  const names = status?.names ?? {}
  const slots = status && !("error" in status) && status.slots ? Object.entries(status.slots) : []

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="grid gap-1 bg-muted/60 py-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
        <div className="flex items-center gap-2">
          <span
            className={cn("size-2.5 shrink-0 rounded-full", status === null ? "bg-muted-foreground/40" : up ? "bg-emerald-500" : "bg-destructive")}
            aria-hidden
          />
          <CardTitle className="text-base">{status === null ? `${name} is not set up` : up ? `${name} is running` : `${name} is down`}</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          {status === null
            ? "Its URL is not configured for this app."
            : "error" in status
              ? status.error
              : up
                ? unit
                  ? `${status.latencyMs} ms · ${total} ${total === 1 ? "worker" : "workers"}${queued ? ` · ${totalQueued} ${totalQueued === 1 ? unit[0] : unit[1]} queued` : ""}`
                  : [`${status.latencyMs} ms`, status.detail].filter(Boolean).join(" · ")
                : `The gateway reported status "${status.health.status}".`}
        </p>
      </CardHeader>

      {health && (workers.length === 0 ? (
        <CardContent className="border-t py-3 text-sm text-muted-foreground">
          No models registered yet. Workers register their model when they start.
        </CardContent>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Model</TableHead>
                <TableHead className="text-right">Workers</TableHead>
                {queued && <TableHead className="text-right">Queued</TableHead>}
                <TableHead className="pr-4 text-right">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map(([id, count]) => (
                <TableRow key={id}>
                  <TableCell className="max-w-0 pl-4">
                    <div className="truncate font-medium" title={names[id] ?? id}>{names[id] ?? id}</div>
                    {names[id] && <div className="truncate text-xs text-muted-foreground">{id}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count}</TableCell>
                  {queued && <TableCell className="text-right tabular-nums">{queued[id] ?? 0}</TableCell>}
                  <TableCell className="pr-4 text-right">
                    {count > 0
                      ? <Badge variant="secondary">Available</Badge>
                      : <Badge variant="destructive">No workers</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {slots.length > 0 && (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Sessions</TableHead>
                <TableHead className="pr-4 text-right">Slots</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map(([state, count]) => (
                <TableRow key={state}>
                  <TableCell className="pl-4 font-medium capitalize">{state}</TableCell>
                  <TableCell className={cn("pr-4 text-right tabular-nums", state === "stuck" && count > 0 && "font-medium text-destructive")}>
                    {count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}

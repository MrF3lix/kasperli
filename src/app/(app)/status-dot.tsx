"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { StatusSummary } from "@/app/api/status/route"
import { cn } from "@/lib/utils"

const INTERVAL_MS = 30_000

/** Green while every service answers, red otherwise; links to the Status page. */
export function StatusDot() {
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const active = usePathname() === "/status"

  useEffect(() => {
    let alive = true
    async function load() {
      if (document.visibilityState !== "visible") return
      try {
        const response = await fetch("/api/status", { cache: "no-store" })
        if (alive && response.ok) setSummary(await response.json())
      } catch {
        // offline: keep the last state
      }
    }
    void load()
    const timer = setInterval(load, INTERVAL_MS)
    document.addEventListener("visibilitychange", load)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener("visibilitychange", load)
    }
  }, [])

  const down = summary?.services.filter((s) => !s.up) ?? []
  const label = summary === null
    ? "Checking services…"
    : down.length === 0
      ? "All services are running"
      : `Down: ${down.map((s) => s.name).join(", ")}`

  return (
    <Link
      href="/status"
      title={label}
      aria-label={`Status: ${label}`}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground", active && "font-medium text-foreground")}
    >
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full",
          summary === null ? "bg-muted-foreground/40" : down.length ? "bg-destructive" : "bg-emerald-500",
        )}
      />
      <span className="hidden sm:inline">Status</span>
    </Link>
  )
}

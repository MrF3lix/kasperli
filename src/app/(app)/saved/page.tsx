import { Suspense } from "react"
import type { Metadata } from "next"
import { Card } from "@/components/ui/card"
import { listSamples } from "@/lib/samples"
import { modelDisplayNames } from "@/lib/model-names"
import { SampleCount, SelectionProvider, SelectionToolbar } from "./sample-selection"
import { SampleList } from "./sample-list"

export const metadata: Metadata = {
  title: "Saved samples · TTS",
}

export default function SavedPage() {
  return (
    <SelectionProvider>
      <div className="grid min-w-0 gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold">Saved samples</h1>
            <p className="text-sm text-muted-foreground">Samples you kept on the generate page or recorded. They stay until you remove them.</p>
            <SampleCount />
          </div>
          <SelectionToolbar />
        </div>
        <Suspense fallback={<Card className="h-64 animate-pulse" />}>
          <SampleTable />
        </Suspense>
      </div>
    </SelectionProvider>
  )
}

async function SampleTable() {
  const [{ items, total, next }, names] = await Promise.all([listSamples(), modelDisplayNames()])
  return <SampleList initialItems={items} initialNext={next} initialTotal={total ?? items.length} {...names} />
}

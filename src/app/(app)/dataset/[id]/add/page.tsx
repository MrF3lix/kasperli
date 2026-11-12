import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { getDataset } from "@/lib/datasets"
import { listSamples } from "@/lib/samples"
import { SampleList } from "../../../saved/sample-list"
import { SelectionProvider, SelectionToolbar } from "../../../saved/sample-selection"
import { modelDisplayNames } from "../../model-names"

export const metadata: Metadata = {
  title: "Add samples · TTS",
}

export default function AddSamplesPage({ params }: PageProps<"/dataset/[id]/add">) {
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <AddSamples params={params} />
    </Suspense>
  )
}

/** The user's saved samples, to select some and add them to the dataset. */
async function AddSamples({ params }: Pick<PageProps<"/dataset/[id]/add">, "params">) {
  const { id } = await params
  const [dataset, { items, total, next }, names] = await Promise.all([getDataset(id), listSamples(), modelDisplayNames()])
  if (!dataset) {
    notFound()
  }
  return (
    <SelectionProvider addTo={{ id: dataset.id, name: dataset.name }}>
      <div className="grid min-w-0 gap-6">
        <Link href={`/dataset/${dataset.id}/edit`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Edit {dataset.name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold">Add samples to {dataset.name}</h1>
            <p className="text-sm text-muted-foreground">
              Select from your saved samples. Ones already in the dataset are skipped.
            </p>
          </div>
          <SelectionToolbar />
        </div>
        <SampleList initialItems={items} initialNext={next} initialTotal={total ?? items.length} {...names} />
      </div>
    </SelectionProvider>
  )
}

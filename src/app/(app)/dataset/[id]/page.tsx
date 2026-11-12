import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, DownloadIcon, PencilIcon } from "lucide-react"
import { LocalTime } from "@/components/local-time"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getDataset } from "@/lib/datasets"
import { DatasetSampleTable } from "../dataset-sample-table"
import { modelDisplayNames } from "@/lib/model-names"
import { UserList } from "../user-list"

export const metadata: Metadata = {
  title: "Dataset · TTS",
}

export default function DatasetPage({ params }: PageProps<"/dataset/[id]">) {
  return (
    <div className="grid min-w-0 gap-6">
      <Link href="/dataset" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Datasets
      </Link>
      <Suspense fallback={<Card className="h-96 animate-pulse" />}>
        <DatasetDetail params={params} />
      </Suspense>
    </div>
  )
}

async function DatasetDetail({ params }: Pick<PageProps<"/dataset/[id]">, "params">) {
  const { id } = await params
  const [dataset, user, names] = await Promise.all([getDataset(id), getCurrentUser(), modelDisplayNames()])
  if (!dataset) {
    notFound()
  }

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold break-words">{dataset.name}</h1>
          <p className="text-sm font-medium">{dataset.sampleCount} {dataset.sampleCount === 1 ? "sample" : "samples"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* a plain link, so the zip streams to disk instead of being buffered in the page */}
          <a
            href={`/api/dataset/${dataset.id}/export`}
            download
            aria-disabled={!dataset.sampleCount || undefined}
            className={buttonVariants({ variant: "outline", className: !dataset.sampleCount ? "pointer-events-none opacity-50" : undefined })}
          >
            <DownloadIcon /> Download
          </a>
          <Link href={`/dataset/${dataset.id}/edit`} className={buttonVariants({ variant: "outline" })}>
            <PencilIcon /> Edit
          </Link>
        </div>
      </div>

      <Card>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Owner</dt>
            <dd title={dataset.owner.email || undefined}>{dataset.owner.id === user.id ? "You" : dataset.owner.name}</dd>
            <dt className="text-muted-foreground">Shared with</dt>
            <dd><UserList users={dataset.users} currentUserId={user.id} /></dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="tabular-nums"><LocalTime value={dataset.created} /></dd>
          </dl>
        </CardContent>
      </Card>

      <DatasetSampleTable samples={dataset.samples} currentUserId={user.id} {...names} />
    </div>
  )
}

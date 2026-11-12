import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getDataset, listUsers } from "@/lib/datasets"
import { modelDisplayNames } from "@/lib/model-names"
import { EditDataset } from "./edit-dataset"

export const metadata: Metadata = {
  title: "Edit dataset · TTS",
}

export default function EditDatasetPage({ params }: PageProps<"/dataset/[id]/edit">) {
  return (
    <Suspense fallback={<Card className="h-96 animate-pulse" />}>
      <Edit params={params} />
    </Suspense>
  )
}

async function Edit({ params }: Pick<PageProps<"/dataset/[id]/edit">, "params">) {
  const { id } = await params
  const [dataset, users, user, names] = await Promise.all([getDataset(id), listUsers(), getCurrentUser(), modelDisplayNames()])
  if (!dataset) {
    notFound()
  }
  return (
    <div className="grid min-w-0 gap-6">
      <Link href={`/dataset/${dataset.id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> {dataset.name}
      </Link>
      <EditDataset dataset={dataset} users={users} currentUserId={user.id} {...names} />
    </div>
  )
}

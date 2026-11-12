import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { LocalTime } from "@/components/local-time"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getCurrentUser } from "@/lib/auth"
import { listDatasets } from "@/lib/datasets"
import { UserList } from "./user-list"

export const metadata: Metadata = {
  title: "Datasets · TTS",
}

export default function DatasetsPage() {
  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Sets of saved samples, shared with other users. Create one with <span className="font-medium">Create Dataset</span> on
          the <Link href="/saved" className="underline underline-offset-4">Saved page</Link>.
        </p>
      </div>
      <Suspense fallback={<Card className="h-48 animate-pulse" />}>
        <DatasetTable />
      </Suspense>
    </div>
  )
}

async function DatasetTable() {
  const [datasets, user] = await Promise.all([listDatasets(), getCurrentUser()])
  if (datasets.length === 0) {
    return <p className="text-sm text-muted-foreground">No datasets yet, and none are shared with you.</p>
  }
  return (
    <div className="min-w-0 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Samples</TableHead>
            <TableHead className="hidden sm:table-cell">Owner</TableHead>
            <TableHead className="hidden md:table-cell">Shared with</TableHead>
            <TableHead className="hidden md:table-cell">Changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {datasets.map((dataset) => (
            <TableRow key={dataset.id} className="align-top">
              <TableCell className="max-w-72 min-w-40 whitespace-normal">
                <Link href={`/dataset/${dataset.id}`} className="font-medium hover:underline hover:underline-offset-4">
                  {dataset.name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{dataset.sampleCount}</TableCell>
              <TableCell className="hidden sm:table-cell">
                {dataset.owner.id === user.id ? "You" : dataset.owner.name}
              </TableCell>
              <TableCell className="hidden max-w-64 whitespace-normal text-muted-foreground md:table-cell">
                <UserList users={dataset.users} currentUserId={user.id} />
              </TableCell>
              <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                <LocalTime value={dataset.updated} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

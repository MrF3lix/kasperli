"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Dataset, UserRef } from "@/lib/datasets"
import { deleteDatasetAction, removeSamplesAction, updateDatasetAction } from "../../actions"
import { DatasetSampleTable } from "../../dataset-sample-table"

type Props = {
  dataset: Dataset
  // everyone who could be given access
  users: UserRef[]
  currentUserId: string
  modelNames: Record<string, string>
  languageNames: Record<string, string>
}

export function EditDataset({ dataset, users, currentUserId, modelNames, languageNames }: Props) {
  const isOwner = dataset.owner.id === currentUserId
  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Edit dataset</h1>
        {isOwner && <DeleteDatasetButton dataset={dataset} />}
      </div>
      <DetailsForm dataset={dataset} users={users} currentUserId={currentUserId} />
      <SampleEditor dataset={dataset} currentUserId={currentUserId} modelNames={modelNames} languageNames={languageNames} />
    </div>
  )
}

function DetailsForm({ dataset, users, currentUserId }: Pick<Props, "dataset" | "users" | "currentUserId">) {
  const router = useRouter()
  const [name, setName] = useState(dataset.name)
  const [access, setAccess] = useState<ReadonlySet<string>>(() => new Set(dataset.users.map((u) => u.id)))
  const [filter, setFilter] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // the owner always has access
  const candidates = users.filter((u) => u.id !== dataset.owner.id)
  const query = filter.trim().toLowerCase()
  const shown = query ? candidates.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query)) : candidates
  const removesSelf = currentUserId !== dataset.owner.id && !access.has(currentUserId)

  function toggle(id: string) {
    const next = new Set(access)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setAccess(next)
    setSaved(false)
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateDatasetAction(dataset.id, name, [...access])
      if (result.error !== undefined) {
        setError(result.error)
        return
      }
      if (removesSelf) {
        router.push("/dataset")
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={save} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="dataset-name">Name</Label>
            <Input
              id="dataset-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              className="max-w-md"
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Access</legend>
            <p className="text-sm text-muted-foreground">
              Everyone with access can view, download and edit this dataset.
              Owner: <span className="font-medium text-foreground">{dataset.owner.id === currentUserId ? "you" : dataset.owner.name}</span>.
            </p>
            {candidates.length > 8 && (
              <Input
                type="search"
                aria-label="Filter users"
                placeholder="Filter users"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="max-w-md"
              />
            )}
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">There are no other users.</p>
            ) : (
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {shown.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={access.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{u.name}{u.id === currentUserId && " (you)"}</span>
                        {u.email && u.email !== u.name && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                      </span>
                    </label>
                  </li>
                ))}
                {!shown.length && <li className="px-2 py-1.5 text-sm text-muted-foreground">No users match.</li>}
              </ul>
            )}
            {removesSelf && (
              <p className="text-sm text-destructive">You removed yourself: after saving you no longer have access to this dataset.</p>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !name.trim()}>
              <SaveIcon /> {pending ? "Saving…" : "Save"}
            </Button>
            {saved && !pending && <span className="text-sm text-muted-foreground" aria-live="polite">Saved</span>}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function SampleEditor({ dataset, currentUserId, modelNames, languageNames }: Pick<Props, "dataset" | "currentUserId" | "modelNames" | "languageNames">) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await removeSamplesAction(dataset.id, [...selected])
      if (result.error !== undefined) {
        setError(result.error)
        return
      }
      setSelected(new Set())
      router.refresh()
    })
  }

  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-semibold">Samples</h2>
          <p className="text-sm text-muted-foreground">
            Removing samples only takes them out of this dataset; they stay saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <Button variant="outline" disabled={pending} onClick={remove}>
              <Trash2Icon /> {pending ? "Removing…" : `Remove ${selected.size} from dataset`}
            </Button>
          )}
          <Link href={`/dataset/${dataset.id}/add`} className={buttonVariants({ variant: "outline" })}>
            <PlusIcon /> Add samples
          </Link>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DatasetSampleTable
        samples={dataset.samples}
        currentUserId={currentUserId}
        modelNames={modelNames}
        languageNames={languageNames}
        selected={selected}
        onSelectedChange={setSelected}
      />
    </section>
  )
}

function DeleteDatasetButton({ dataset }: { dataset: Dataset }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await deleteDatasetAction(dataset.id)
      if (result.error !== undefined) {
        setError(result.error)
        return
      }
      router.push("/dataset")
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); setError(null) }}>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        <Trash2Icon /> Delete dataset
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this dataset?</AlertDialogTitle>
          <AlertDialogDescription>
            The dataset <i>“{dataset.name}”</i> is deleted for everyone with access. Its samples stay saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

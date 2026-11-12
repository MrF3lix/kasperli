"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DatabaseIcon, DownloadIcon, PlusIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableHead } from "@/components/ui/table"
import { addSamplesAction, createDatasetAction } from "../dataset/actions"

// Selecting saved samples: to export them, to create a dataset from them, or (on a dataset's
// "add samples" page) to add them to that dataset.
type Mode = "export" | "dataset" | "add"

// "all" also covers samples the page hasn't loaded yet; `ids` are then the ones left out
type Selected = { all: boolean; ids: ReadonlySet<string> }

type Selection = {
  mode: Mode | null
  setMode: (mode: Mode | null) => void
  selected: Selected
  setSelected: (selected: Selected) => void
  // number of saved samples, loaded or not; the toolbar is hidden without any
  total: number
  setTotal: (total: number) => void
  // the dataset samples are added to, in "add" mode
  addTo?: { id: string; name: string }
}

const NONE: Selected = { all: false, ids: new Set() }

const Context = createContext<Selection | null>(null)

/** With `addTo`, samples are always being selected for adding them to that dataset. */
export function SelectionProvider({ children, addTo }: { children: React.ReactNode; addTo?: { id: string; name: string } }) {
  const [mode, setMode] = useState<Mode | null>(addTo ? "add" : null)
  const [selected, setSelected] = useState<Selected>(NONE)
  const [total, setTotal] = useState(0)

  const value: Selection = {
    mode,
    setMode: (next) => {
      setMode(next)
      if (!next) setSelected(NONE)
    },
    selected,
    setSelected,
    total,
    setTotal,
    addTo,
  }
  return <Context value={value}>{children}</Context>
}

function useSelection() {
  const selection = useContext(Context)
  if (!selection) throw new Error("missing SelectionProvider")
  return selection
}

function selectedCount({ selected, total }: Selection): number {
  return selected.all ? total - selected.ids.size : selected.ids.size
}

// as the export route and the dataset actions expect it
function selectionBody(selected: Selected) {
  return selected.all ? { all: true, exclude: [...selected.ids] } : { ids: [...selected.ids] }
}

/** For the sample list: reports the number of samples and drops deleted ones from the selection. */
export function useSampleSelection(total: number) {
  const { setTotal, selected, setSelected } = useSelection()
  useEffect(() => {
    setTotal(total)
    return () => setTotal(0)
  }, [total, setTotal])

  return {
    deselectDeleted(id: string) {
      if (!selected.ids.has(id)) return
      const ids = new Set(selected.ids)
      ids.delete(id)
      setSelected({ ...selected, ids })
    },
  }
}

/** How many samples are saved; nothing until the list has loaded or when there are none. */
export function SampleCount() {
  const { total } = useSelection()
  if (!total) return null
  return <p className="text-sm font-medium">{total} {total === 1 ? "sample" : "samples"} saved</p>
}

/** The Export and Create Dataset buttons; while selecting, the number of selected samples and what to do with them. */
export function SelectionToolbar() {
  const selection = useSelection()
  const { mode, setMode, total } = selection

  if (!total) {
    return null
  }
  if (!mode) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setMode("export")}>
          <DownloadIcon /> Export
        </Button>
        <Button variant="outline" onClick={() => setMode("dataset")}>
          <DatabaseIcon /> Create Dataset
        </Button>
      </div>
    )
  }
  const status = <span className="text-sm text-muted-foreground" aria-live="polite">{selectedCount(selection)} of {total} selected</span>
  if (mode === "export") return <ExportActions status={status} />
  if (mode === "dataset") return <CreateDatasetActions status={status} />
  return <AddToDatasetActions status={status} />
}

type ActionsProps = { status: React.ReactNode }

function Toolbar({ children, error }: { children: React.ReactNode; error: string | null }) {
  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function ExportActions({ status }: ActionsProps) {
  const selection = useSelection()
  const { setMode, selected } = selection
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch("/api/samples/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectionBody(selected)),
      })
      if (!response.ok) {
        const { detail } = await response.json().catch(() => ({}))
        setError(typeof detail === "string" ? detail : "The export failed. Try again later.")
        return
      }
      const blob = await response.blob()
      const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "tts-samples.zip"
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
      setMode(null)
    } catch {
      setError("The export failed. Try again later.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Toolbar error={error}>
      {status}
      <Button variant="ghost" disabled={pending} onClick={() => setMode(null)}>Cancel</Button>
      <Button disabled={pending || !selectedCount(selection)} onClick={download}>
        <DownloadIcon /> {pending ? "Preparing zip…" : "Download zip"}
      </Button>
    </Toolbar>
  )
}

function CreateDatasetActions({ status }: ActionsProps) {
  const selection = useSelection()
  const { setMode, selected } = selection
  const router = useRouter()
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = selectedCount(selection)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Give the dataset a name.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await createDatasetAction(name, selectionBody(selected))
      if (result.error !== undefined) {
        setError(result.error)
        setPending(false)
        return
      }
      router.push(`/dataset/${result.id}`)
    } catch {
      setError("Saving the dataset failed. Try again later.")
      setPending(false)
    }
  }

  return (
    <form onSubmit={save}>
      <Toolbar error={error}>
        {status}
        <Input
          aria-label="Dataset name"
          placeholder="Dataset name"
          className="w-48"
          maxLength={200}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setMode(null)}>Cancel</Button>
        <Button type="submit" disabled={pending || !count}>
          <DatabaseIcon /> {pending ? "Saving…" : "Save Dataset"}
        </Button>
      </Toolbar>
    </form>
  )
}

function AddToDatasetActions({ status }: ActionsProps) {
  const selection = useSelection()
  const { selected, addTo } = selection
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!addTo) return null
  const back = `/dataset/${addTo.id}/edit`

  async function add() {
    setPending(true)
    setError(null)
    try {
      const result = await addSamplesAction(addTo!.id, selectionBody(selected))
      if (result.error !== undefined) {
        setError(result.error)
        setPending(false)
        return
      }
      router.push(back)
    } catch {
      setError("Adding the samples failed. Try again later.")
      setPending(false)
    }
  }

  return (
    <Toolbar error={error}>
      {status}
      <Link href={back} className={buttonVariants({ variant: "ghost" })}>Cancel</Link>
      <Button disabled={pending || !selectedCount(selection)} onClick={add}>
        <PlusIcon /> {pending ? "Adding…" : "Add to dataset"}
      </Button>
    </Toolbar>
  )
}

const CHECKBOX = "size-4 cursor-pointer accent-primary align-middle"

/** Header cell that selects all saved samples, including the ones not loaded yet. */
export function SelectAllHead() {
  const selection = useSelection()
  const { mode, setSelected, total } = selection
  const ref = useRef<HTMLInputElement>(null)
  const count = selectedCount(selection)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < total
  })

  if (!mode) return null
  return (
    <TableHead className="w-8">
      <input
        ref={ref}
        type="checkbox"
        aria-label={`Select all ${total} samples`}
        className={CHECKBOX}
        checked={count > 0 && count === total}
        onChange={(e) => setSelected({ all: e.target.checked, ids: new Set() })}
      />
    </TableHead>
  )
}

/** A row's checkbox cell, shown while selecting samples. */
export function SelectRowCell({ id }: { id: string }) {
  const { mode, selected, setSelected } = useSelection()
  if (!mode) return null
  // with "all", the ids are the samples left out
  const checked = selected.all !== selected.ids.has(id)
  return (
    <TableCell className="w-8 pt-3 align-top">
      <input
        type="checkbox"
        aria-label="Select sample"
        className={CHECKBOX}
        checked={checked}
        onChange={() => {
          const ids = new Set(selected.ids)
          if (ids.has(id)) ids.delete(id)
          else ids.add(id)
          setSelected({ ...selected, ids })
        }}
      />
    </TableCell>
  )
}

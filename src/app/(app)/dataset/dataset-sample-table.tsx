"use client"

import Link from "next/link"
import { LocalTime } from "@/components/local-time"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DatasetSample } from "@/lib/datasets"
import { PlayButton } from "../saved/play-button"

type Props = {
  samples: DatasetSample[]
  currentUserId: string
  // display names by model id and by "model/language code"
  modelNames: Record<string, string>
  languageNames: Record<string, string>
  // checkboxes for choosing samples by their linkId, e.g. for removing them from the dataset
  selected?: ReadonlySet<string>
  onSelectedChange?: (selected: Set<string>) => void
}

const CHECKBOX = "size-4 cursor-pointer accent-primary align-middle"

/** The samples of a dataset; only one's own samples link to their annotation. */
export function DatasetSampleTable({ samples, currentUserId, modelNames, languageNames, selected, onSelectedChange }: Props) {
  const selectable = !!selected && !!onSelectedChange
  const allSelected = selectable && samples.length > 0 && samples.every((s) => selected.has(s.linkId))

  if (!samples.length) {
    return <p className="text-sm text-muted-foreground">This dataset has no samples.</p>
  }

  return (
    <div className="min-w-0 rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label={`Select all ${samples.length} samples`}
                  className={CHECKBOX}
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && selected.size > 0 }}
                  onChange={(e) => onSelectedChange(new Set(e.target.checked ? samples.map((s) => s.linkId) : []))}
                />
              </TableHead>
            )}
            <TableHead>Sample</TableHead>
            <TableHead className="hidden md:table-cell">Generated with</TableHead>
            <TableHead>Annotation</TableHead>
            <TableHead className="hidden sm:table-cell">Saved by</TableHead>
            <TableHead className="hidden md:table-cell">Saved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {samples.map((sample) => {
            const own = sample.owner.id === currentUserId
            return (
              <TableRow key={sample.linkId} className="align-top">
                {selectable && (
                  <TableCell className="w-8 pt-3 align-top">
                    <input
                      type="checkbox"
                      aria-label="Select sample"
                      className={CHECKBOX}
                      checked={selected.has(sample.linkId)}
                      onChange={() => {
                        const next = new Set(selected)
                        if (next.has(sample.linkId)) next.delete(sample.linkId)
                        else next.add(sample.linkId)
                        onSelectedChange(next)
                      }}
                    />
                  </TableCell>
                )}
                <TableCell className="max-w-72 min-w-48 align-top whitespace-normal">
                  <div className="flex items-start gap-3">
                    <PlayButton id={sample.id} />
                    {own ? (
                      <Link href={`/saved/${sample.id}`} title={sample.text} className="line-clamp-2 hover:underline hover:underline-offset-4">
                        {sample.text}
                      </Link>
                    ) : (
                      <span title={sample.text} className="line-clamp-2">{sample.text}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden pt-3 align-top whitespace-normal md:table-cell">
                  <p className="font-medium">{modelNames[sample.model] ?? sample.model}</p>
                  <p>{languageNames[`${sample.model}/${sample.language}`] ?? sample.language}</p>
                  <p className="text-xs text-muted-foreground">{sample.speakerName ?? "Unknown speaker"} · seed {sample.seed}</p>
                </TableCell>
                <TableCell className="pt-3 align-top">
                  <div className="grid">
                    {sample.errorTotal === null ? (
                      <span className="text-muted-foreground">Not annotated</span>
                    ) : (
                      <span className="font-medium">{sample.errorTotal} {sample.errorTotal === 1 ? "Abweichung" : "Abweichungen"}</span>
                    )}
                    {sample.hasDieth && <span className="text-xs text-muted-foreground">Dieth transcript</span>}
                  </div>
                </TableCell>
                <TableCell className="hidden pt-3 align-top sm:table-cell" title={sample.owner.email || undefined}>
                  {own ? "You" : sample.owner.name}
                </TableCell>
                <TableCell className="hidden pt-3 align-top text-muted-foreground tabular-nums md:table-cell">
                  <LocalTime value={sample.created} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

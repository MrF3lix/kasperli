/** A sample's text, or a placeholder for recordings whose transcript hasn't been added yet. */
export function SampleText({ text }: { text: string }) {
  return text ? text : <span className="text-muted-foreground italic">No transcript yet</span>
}

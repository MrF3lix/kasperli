/**
 * The duration in seconds of a 16-bit mono PCM WAV file (what lib/wav.ts writes), or null for
 * anything else. Reads only the header, so it runs on the server too.
 */
export function wavDuration(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer)
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4))
  if (buffer.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return null
  }
  let byteRate = 0
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === "fmt " && size >= 16) {
      const format = view.getUint16(offset + 8, true)
      const channels = view.getUint16(offset + 10, true)
      const bits = view.getUint16(offset + 22, true)
      if (format !== 1 || channels !== 1 || bits !== 16) return null
      byteRate = view.getUint32(offset + 16, true)
    } else if (id === "data") {
      const dataSize = Math.min(size, buffer.byteLength - offset - 8)
      return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

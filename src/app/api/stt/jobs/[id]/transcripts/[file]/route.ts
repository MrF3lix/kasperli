import { verifiedToken } from "@/lib/gateway"
import { getTranscript, sttErrorResponse } from "@/lib/stt"
import { JOB_ID, TRANSCRIPT_FORMATS, type TranscriptFormat } from "@/lib/transcribe"

// a finished file's transcript: /api/stt/jobs/{id}/transcripts/{index}.{txt,json,srt,vtt};
// ?download=<name> saves it as <name>.<format> instead of showing it
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id, file } = await params
  const match = /^(\d{1,3})\.(\w+)$/.exec(file)
  const format = match?.[2] as TranscriptFormat | undefined
  if (!JOB_ID.test(id) || !match || !format || !TRANSCRIPT_FORMATS.includes(format)) {
    return Response.json({ detail: "Unknown transcript." }, { status: 404 })
  }
  try {
    const transcript = await getTranscript(id, Number(match[1]), format)
    const headers = new Headers({ "cache-control": "no-store" })
    headers.set("content-type", transcript.headers.get("content-type") ?? "text/plain; charset=utf-8")
    const download = new URL(request.url).searchParams.get("download")
    if (download) {
      const name = `${download.replace(/\.[^.]*$/, "")}.${format}`
      headers.set("content-disposition", `attachment; filename="${name.replace(/[^\w. -]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    }
    return new Response(transcript.body, { headers })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

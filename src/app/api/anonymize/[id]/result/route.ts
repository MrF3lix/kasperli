import { anonymizationResult, anonymizerErrorResponse } from "@/lib/anonymizer"
import { isJobId, notFound, verifiedToken } from "@/lib/gateway"

// the anonymized recording; ?download=1 makes the browser save the file instead of playing it
export async function GET(request: Request, ctx: RouteContext<"/api/anonymize/[id]/result">) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!isJobId(id)) return notFound()
  let upstream: Response
  try {
    upstream = await anonymizationResult(id)
  } catch (e) {
    return anonymizerErrorResponse(e)
  }
  const headers = new Headers({ "content-type": "audio/wav", "cache-control": "private, max-age=86400" })
  const length = upstream.headers.get("content-length")
  if (length && !upstream.headers.has("content-encoding")) headers.set("content-length", length)
  if (new URL(request.url).searchParams.has("download")) {
    headers.set("content-disposition", `attachment; filename="anonymized-${id.slice(0, 8)}.wav"`)
  }
  return new Response(upstream.body, { headers })
}

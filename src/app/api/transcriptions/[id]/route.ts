import { isJobId, notFound, verifiedToken } from "@/lib/gateway"
import { cancelTranscription, getTranscription, sttErrorResponse } from "@/lib/stt"

// the state of a transcription, with its text once it is completed; poll every 2 s until then.
// Ids are random (128 bit) and only given to the user who started the transcription.
export async function GET(_request: Request, ctx: RouteContext<"/api/transcriptions/[id]">) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!isJobId(id)) return notFound()
  try {
    return Response.json(await getTranscription(id), { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/transcriptions/[id]">) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!isJobId(id)) return notFound()
  try {
    await cancelTranscription(id)
    return new Response(null, { status: 204 })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

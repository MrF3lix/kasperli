import { anonymizerErrorResponse, deleteAnonymization, getAnonymization } from "@/lib/anonymizer"
import { isJobId, notFound, verifiedToken } from "@/lib/gateway"

// The state of an anonymization job; poll it until it is completed or failed. Ids are random
// (128 bit) and only given to the user who submitted the job.
export async function GET(_request: Request, ctx: RouteContext<"/api/anonymize/[id]">) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!isJobId(id)) return notFound()
  try {
    return Response.json(await getAnonymization(id), { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return anonymizerErrorResponse(e)
  }
}

// deletes the job and its audio; a queued job is skipped
export async function DELETE(_request: Request, ctx: RouteContext<"/api/anonymize/[id]">) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!isJobId(id)) return notFound()
  try {
    await deleteAnonymization(id)
    return new Response(null, { status: 204 })
  } catch (e) {
    return anonymizerErrorResponse(e)
  }
}

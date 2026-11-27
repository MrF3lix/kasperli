import { verifiedToken } from "@/lib/gateway"
import { hangUp } from "@/lib/speech-to-speech"

// ends a conversation, so the service's only conversation slot frees up right away
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await params
  if (!/^[\w-]{1,200}$/.test(id)) {
    return Response.json({ detail: "Unknown call." }, { status: 404 })
  }
  await hangUp(id)
  return new Response(null, { status: 204 })
}

import { tokenUserId } from "@/lib/auth-token"
import { verifiedToken } from "@/lib/gateway"
import { exportSamples, parseSelection } from "@/lib/samples"

// a zip of the signed-in user's samples: body {"ids": ["...", ...]} for these samples, or
// {"all": true, "exclude": ["...", ...]} for all of them except some (including ones the page hasn't loaded)
export async function POST(request: Request) {
  const token = await verifiedToken()
  if (!token) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const selection = parseSelection(await request.json().catch(() => ({})))
  if ("error" in selection) {
    return Response.json({ detail: selection.error }, { status: 400 })
  }

  let zip
  try {
    zip = await exportSamples(token, tokenUserId(token)!, selection)
  } catch (e) {
    console.error("exporting samples failed", e)
    return Response.json({ detail: "The export failed. Try again later." }, { status: 500 })
  }
  if (!zip) {
    return Response.json({ detail: "The selected samples no longer exist." }, { status: 404 })
  }
  const date = new Date().toISOString().slice(0, 10)
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="tts-samples-${date}.zip"`,
      "cache-control": "no-store",
    },
  })
}

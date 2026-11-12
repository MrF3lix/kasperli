import { exportDataset } from "@/lib/datasets"
import { verifiedToken } from "@/lib/gateway"

// a zip of a dataset the signed-in user has access to: its samples like an export from the Saved
// page, plus dataset.json with its name and who has access
export async function GET(_request: Request, ctx: RouteContext<"/api/dataset/[id]/export">) {
  const token = await verifiedToken()
  if (!token) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await ctx.params

  let result
  try {
    result = await exportDataset(token, id)
  } catch (e) {
    console.error("exporting a dataset failed", e)
    return Response.json({ detail: "The download failed. Try again later." }, { status: 500 })
  }
  if (!result) {
    return Response.json({ detail: "Not found" }, { status: 404 })
  }
  return new Response(result.zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "cache-control": "no-store",
    },
  })
}

import { verifiedToken } from "@/lib/gateway"
import { cancelTranscribeJob, getTranscribeJob, sttErrorResponse } from "@/lib/stt"
import { JOB_ID } from "@/lib/transcribe"

type Params = { params: Promise<{ id: string }> }

// a transcription job's status, progress and texts; poll while it is unfinished
export async function GET(_request: Request, { params }: Params) {
  return handle(params, getTranscribeJob)
}

// cancels the files that haven't started
export async function DELETE(_request: Request, { params }: Params) {
  return handle(params, cancelTranscribeJob)
}

async function handle(params: Params["params"], action: (id: string) => Promise<unknown>) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const { id } = await params
  if (!JOB_ID.test(id)) {
    return Response.json({ detail: "The transcription has expired." }, { status: 404 })
  }
  try {
    return Response.json(await action(id), { headers: { "cache-control": "no-store" } })
  } catch (e) {
    return sttErrorResponse(e)
  }
}

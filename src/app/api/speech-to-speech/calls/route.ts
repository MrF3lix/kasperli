import { verifiedToken } from "@/lib/gateway"
import { MAX_SDP_BYTES, SpeechToSpeechError, startCall } from "@/lib/speech-to-speech"

// WebRTC handshake for a conversation: the browser's SDP offer in (application/sdp), the
// service's answer out, with the call's id in the x-call-id header for hanging up
export async function POST(request: Request) {
  if (!await verifiedToken()) {
    return Response.json({ detail: "Not signed in" }, { status: 401 })
  }
  const offer = await request.text().catch(() => "")
  if (!offer.startsWith("v=0") || offer.length > MAX_SDP_BYTES) {
    return Response.json({ detail: "Not an SDP offer." }, { status: 400 })
  }
  try {
    const { answer, callId } = await startCall(offer)
    return new Response(answer, {
      headers: { "content-type": "application/sdp", "cache-control": "no-store", ...(callId ? { "x-call-id": callId } : {}) },
    })
  } catch (e) {
    if (e instanceof SpeechToSpeechError) {
      return Response.json({ detail: e.message }, { status: e.status })
    }
    throw e
  }
}

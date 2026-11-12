import "server-only"
import { requireToken } from "@/lib/auth"
import { getModels } from "@/lib/gateway"
import { displayNames } from "@/lib/tts"

/** Model and dialect display names; ids and codes are shown while the gateway is unreachable. */
export async function modelDisplayNames() {
  const models = await getModels(await requireToken())
  return displayNames("error" in models ? [] : models)
}

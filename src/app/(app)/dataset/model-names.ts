import "server-only"
import { requireToken } from "@/lib/auth"
import { getModels } from "@/lib/gateway"

/** Model and dialect display names; ids and codes are shown while the gateway is unreachable. */
export async function modelDisplayNames() {
  const models = await getModels(await requireToken())
  const modelList = "error" in models ? [] : models
  return {
    modelNames: Object.fromEntries(modelList.map((m) => [m.id, m.name])),
    languageNames: Object.fromEntries(modelList.flatMap((m) => m.languages.map((l) => [`${m.id}/${l.code}`, l.name]))),
  }
}

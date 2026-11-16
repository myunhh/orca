import { z } from 'zod'

const pluginHostCallRequestSchema = z
  .object({
    method: z.string().min(1).max(128),
    params: z.unknown().optional()
  })
  .strict()

export type PluginHostCallRequest = z.infer<typeof pluginHostCallRequestSchema>

export function isPluginHostCallRequest(request: unknown): request is PluginHostCallRequest {
  return pluginHostCallRequestSchema.safeParse(request).success
}

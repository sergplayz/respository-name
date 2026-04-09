import type { VercelRequest, VercelResponse } from '@vercel/node'
import { matcomProxyHandler } from './matcomProxyShared'

/**
 * Proxies same-origin `/api/*` → Render FastAPI.
 * Explicit `api/admin/*.ts` routes also exist — some Vercel projects 404 nested `/api/admin/*`
 * when only this catch-all is deployed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  const m = url.pathname.match(/^\/api(?:\/(.*))?$/i)
  const apiPath = m?.[1] ? decodeURIComponent(m[1]) : ''
  await matcomProxyHandler(req, res, apiPath, url.search)
}

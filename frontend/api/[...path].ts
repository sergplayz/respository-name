import type { VercelRequest, VercelResponse } from '@vercel/node'
import { matcomProxyHandler } from './matcomProxyShared'

/**
 * Proxies same-origin `/api/*` → Render FastAPI.
 * Admin auth uses flat `/api/matcom-login` and `/api/matcom-db-status` (see sibling files).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  const m = url.pathname.match(/^\/api(?:\/(.*))?$/i)
  const apiPath = m?.[1] ? decodeURIComponent(m[1]) : ''
  await matcomProxyHandler(req, res, apiPath, url.search)
}

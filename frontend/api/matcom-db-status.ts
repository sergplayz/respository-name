import type { VercelRequest, VercelResponse } from '@vercel/node'
import { matcomProxyHandler } from './matcomProxyShared'

/** Flat path — proxies to FastAPI `GET /api/admin/db-status`. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  await matcomProxyHandler(req, res, 'admin/db-status', url.search)
}

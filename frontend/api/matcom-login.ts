import type { VercelRequest, VercelResponse } from '@vercel/node'
import { matcomProxyHandler } from './matcomProxyShared'

/** Flat path — avoids Vercel 404s on nested `/api/admin/login`. Proxies to FastAPI `/api/admin/login`. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  await matcomProxyHandler(req, res, 'admin/login', url.search)
}

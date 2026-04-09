import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Proxies same-origin `/api/*` → Render FastAPI.
 * Vercel env: RENDER_API_URL = https://your-service.onrender.com (no trailing slash).
 *
 * Important: Vercel project "Root Directory" must be `frontend` (this folder), or `api/` is not deployed.
 */

const HOP_BY_HOP = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
])

// fetch() decompresses the body; forwarding Content-Encoding breaks clients.
const STRIP_FROM_CLIENT = new Set([
  ...HOP_BY_HOP,
  'content-encoding',
  'content-length',
])

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(body))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const raw = process.env.RENDER_API_URL?.trim() ?? ''
    if (!raw) {
      json(res, 503, {
        error:
          'RENDER_API_URL is not set on Vercel. Add it under Environment Variables (Production + Preview).',
      })
      return
    }

    let base: string
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        json(res, 503, { error: 'RENDER_API_URL must start with http:// or https://' })
        return
      }
      base = `${u.protocol}//${u.host}`
    } catch {
      json(res, 503, { error: 'RENDER_API_URL is not a valid URL.' })
      return
    }

    const url = new URL(req.url || '/', 'http://localhost')
    const m = url.pathname.match(/^\/api(?:\/(.*))?$/i)
    const apiPath = m?.[1] ? decodeURIComponent(m[1]) : ''
    const target = `${base}/api/${apiPath}${url.search}`

    const headers = new Headers()
    headers.set(
      'user-agent',
      'matcom-vercel-proxy/1.0 (serverless; contact: your-team)',
    )
    const allow = ['accept', 'accept-language', 'content-type', 'authorization']
    for (const name of allow) {
      const v = req.headers[name]
      if (v == null) continue
      headers.set(name, Array.isArray(v) ? v[0] : v)
    }

    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof req.body === 'string') body = req.body
      else if (Buffer.isBuffer(req.body)) body = req.body.toString('utf8')
      else if (req.body != null) body = JSON.stringify(req.body)
    }

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
    })

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (STRIP_FROM_CLIENT.has(key.toLowerCase())) return
      res.setHeader(key, value)
    })

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    json(res, 502, {
      error: 'Proxy could not reach your Render API.',
      detail: message,
      hint:
        'Confirm RENDER_API_URL, that Render is awake (free tier sleeps — wait and retry), and that your Vercel project Root Directory is `frontend` so this function is deployed.',
    })
  }
}

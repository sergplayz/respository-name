import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Proxies browser calls to same-origin `/api/*` → Render FastAPI.
 * Set `RENDER_API_URL` on Vercel (e.g. https://your-app.onrender.com) for Production + Preview.
 * No CORS needed between browser and Render; this runs on Vercel only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const base = process.env.RENDER_API_URL?.trim().replace(/\/$/, '')
  if (!base) {
    res.status(503).setHeader('Content-Type', 'application/json; charset=utf-8')
    res.send(
      JSON.stringify({
        error:
          'RENDER_API_URL is not set on Vercel. Add it under Environment Variables (Production + Preview) for this project — your Render API origin with no trailing slash.',
      }),
    )
    return
  }

  const url = new URL(req.url || '/', 'http://localhost')
  // Prefer pathname (reliable); query keys for [...path] differ by runtime.
  const m = url.pathname.match(/^\/api(?:\/(.*))?$/i)
  const apiPath = m?.[1] ? decodeURIComponent(m[1]) : ''
  const target = `${base}/api/${apiPath}${url.search}`

  const headers = new Headers()
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
    const k = key.toLowerCase()
    if (k === 'transfer-encoding' || k === 'connection') return
    res.setHeader(key, value)
  })

  const buf = Buffer.from(await upstream.arrayBuffer())
  res.send(buf)
}

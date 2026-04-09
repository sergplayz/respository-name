import type { VercelRequest, VercelResponse } from '@vercel/node'

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

const STRIP_FROM_CLIENT = new Set([
  ...HOP_BY_HOP,
  'content-encoding',
  'content-length',
])

export const ENV_KEYS = [
  'RENDER_API_URL',
  'MATCOM_API_URL',
  'VITE_API_URL',
] as const

export function readBackendBase(): { ok: true; base: string } | { ok: false; reason: string } {
  for (const key of ENV_KEYS) {
    let raw = process.env[key]?.trim() ?? ''
    raw = raw.replace(/^['"]+|['"]+$/g, '')
    if (!raw) continue
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      return { ok: true, base: `${u.protocol}//${u.host}` }
    } catch {
      continue
    }
  }
  return {
    ok: false,
    reason:
      'No backend URL in environment. Add RENDER_API_URL (or MATCOM_API_URL) in Vercel → Environment Variables for Production and Preview, then redeploy.',
  }
}

function json(res: VercelResponse, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(JSON.stringify(body))
}

/**
 * @param apiPath - path after `/api/` on the origin (e.g. `health`, `admin/login`)
 */
export async function matcomProxyHandler(
  req: VercelRequest,
  res: VercelResponse,
  apiPath: string,
  search: string,
): Promise<void> {
  try {
    const resolved = readBackendBase()
    if (resolved.ok) {
      const { base } = resolved
      const target = `${base}/api/${apiPath}${search}`

      const headers = new Headers()
      headers.set('user-agent', 'matcom-vercel-proxy/1.0')
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
    } else {
      json(res, 503, {
        error: resolved.reason,
        status: 503,
        checked_env_keys: [...ENV_KEYS],
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    json(res, 502, {
      error: 'Proxy could not reach your Render API.',
      detail: message,
      hint:
        'Check RENDER_API_URL, wake Render (free tier sleeps). If Vercel Root Directory is empty, repo-root vercel.json + api/ deploys this proxy; if Root Directory is frontend, use frontend/api/.',
    })
  }
}

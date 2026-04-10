/**
 * Vercel Edge Middleware: proxies `/api/*` → Render (same-origin fetch from the browser).
 * More reliable than `api/*.ts` serverless with Vite monorepos (often 404).
 *
 * Env (Vercel → Settings → Environment Variables): RENDER_API_URL or MATCOM_API_URL
 * (full URL, e.g. https://your-api.onrender.com — no trailing slash).
 */

const STRIP_FROM_RESPONSE = new Set([
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
  'content-encoding',
  'content-length',
])

const ENV_KEYS = ['RENDER_API_URL', 'MATCOM_API_URL', 'VITE_API_URL'] as const

function readBackendBase(): { ok: true; base: string } | { ok: false; reason: string } {
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
      'No backend URL in environment. Set RENDER_API_URL (or MATCOM_API_URL) for Production and Preview on this Vercel project, then redeploy.',
  }
}

export const config = {
  matcher: ['/api', '/api/:path*'],
}

export default async function middleware(request: Request): Promise<Response> {
  const incoming = new URL(request.url)
  if (!incoming.pathname.startsWith('/api')) {
    return new Response(null, { status: 404 })
  }

  const resolved = readBackendBase()
  if (!resolved.ok) {
    return new Response(
      JSON.stringify({
        error: resolved.reason,
        status: 503,
        checked_env_keys: [...ENV_KEYS],
        hint: 'Vercel → Project → Settings → Environment Variables. Add RENDER_API_URL for both Production and Preview.',
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    )
  }

  const targetUrl = `${resolved.base}${incoming.pathname}${incoming.search}`

  const headers = new Headers()
  headers.set('user-agent', 'matcom-vercel-edge-middleware/1.0')
  for (const name of ['accept', 'accept-language', 'content-type', 'authorization']) {
    const v = request.headers.get(name)
    if (v) headers.set(name, v)
  }

  let body: string | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text()
  }

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: body ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({
        error: 'Proxy could not reach your Render API.',
        detail: message,
        hint: 'Wake the Render service (open its URL once), check RENDER_API_URL, then retry.',
      }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }

  const out = new Headers(upstream.headers)
  for (const h of STRIP_FROM_RESPONSE) {
    out.delete(h)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}

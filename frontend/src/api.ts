/**
 * Local dev: `/api` is proxied to FastAPI (vite.config).
 * Vercel: `/api/*` is handled by `api/[...path].ts`, which forwards to `RENDER_API_URL`.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return p
}

/** Read JSON from a fetch Response; detect HTML (SPA fallback / 404 page) and throw a clear error. */
export async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`)
  }
  const head = text.trimStart().slice(0, 64).toLowerCase()
  if (head.startsWith('<!') || head.startsWith('<html')) {
    throw new Error(
      'API_HTML_NOT_JSON: The server returned the web app page instead of JSON for /api. ' +
        'Redeploy the site with the latest vercel.json (filesystem handle before SPA fallback). ' +
        'Confirm Vercel Root Directory includes the api/ folder and RENDER_API_URL is set.',
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      text.includes('<!doctype') || text.includes('<html')
        ? 'API_HTML_NOT_JSON'
        : text.slice(0, 240) || 'Invalid JSON from API',
    )
  }
}

export function friendlyFetchError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('api_html_not_json') || m.includes('unexpected token') || m.includes('<!doctype')) {
    return (
      'The app expected JSON from /api but got an HTML page (usually your Vercel SPA). ' +
        'Fix: push the latest vercel.json, redeploy Vercel, and set Root Directory to frontend (or repo root with root api/). ' +
        'Set RENDER_API_URL to your Render API. In DevTools → Network, /api/tables should be JSON, not index.html.'
    )
  }
  if (m === 'failed to fetch' || m.includes('networkerror') || m.includes('load failed')) {
    return (
      'Network error talking to this site’s /api route. Common fixes: (1) In Vercel → Settings → General, ' +
      'set Root Directory to frontend (the folder that contains the api/ folder), then redeploy. ' +
      '(2) Set RENDER_API_URL to your full Render URL, e.g. https://my-api.onrender.com — include https://, no trailing slash. ' +
      '(3) Free Render apps sleep: open your Render URL in a browser once, wait ~30s, refresh this page. ' +
      '(4) If it still fails, open DevTools → Network, click the failed /api request, and check Status / Response.'
    )
  }
  if (
    message.includes('NOT_FOUND') ||
    message.includes('The page could not be found') ||
    /::[a-z0-9]+-\d+-\d+[a-f0-9]+/i.test(message)
  ) {
    return (
      'Vercel returned 404 for /api — no serverless route handled the request. ' +
      'Either set Vercel → Root Directory to frontend (so frontend/api deploys), ' +
      'or leave Root Directory empty and deploy from the repo root (vercel.json + api/ at repo root). ' +
      'Then set RENDER_API_URL to your Render API URL and redeploy.'
    )
  }
  try {
    const j = JSON.parse(message) as { error?: string; hint?: string; checked_env_keys?: string[] }
    if (j.error) {
      let s = j.error
      if (j.checked_env_keys?.length) {
        s += ` (looked for: ${j.checked_env_keys.join(', ')})`
      }
      if (j.hint) s += ` ${j.hint}`
      return s
    }
  } catch {
    /* not JSON */
  }
  if (message.includes('RENDER_API_URL') || message.includes('Proxy could not reach')) {
    return message.length > 600 ? `${message.slice(0, 600)}…` : message
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

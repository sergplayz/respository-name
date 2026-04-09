/**
 * Local dev: `/api` is proxied to FastAPI (vite.config).
 * Vercel: `/api/*` is handled by `api/[...path].ts`, which forwards to `RENDER_API_URL`.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return p
}

export function friendlyFetchError(message: string): string {
  const m = message.toLowerCase()
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
      'Vercel returned 404 for /api — the serverless proxy is probably not deployed. ' +
      'Set the Vercel project Root Directory to frontend and redeploy, and ensure RENDER_API_URL is set.'
    )
  }
  if (message.includes('RENDER_API_URL') || message.includes('Proxy could not reach')) {
    return message.length > 600 ? `${message.slice(0, 600)}…` : message
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

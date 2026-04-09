/**
 * Local dev: leave API env unset → relative `/api` + Vite proxy.
 * Vercel: set `RENDER_API_URL` or `VITE_API_URL` (no trailing slash) on the project;
 * it is baked in at **build** time via vite.config `define`.
 */
export function apiUrl(path: string): string {
  const base = __API_ORIGIN__.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  if (!base) return p
  return `${base}${p}`
}

export function friendlyFetchError(message: string): string {
  if (
    message.includes('NOT_FOUND') ||
    message.includes('The page could not be found') ||
    /::[a-z0-9]+-\d+-\d+[a-f0-9]+/i.test(message)
  ) {
    return (
      'API URL is missing from the built site. In Vercel → Settings → Environment Variables, add ' +
      'RENDER_API_URL (recommended) or VITE_API_URL = https://your-service.onrender.com (no trailing slash). ' +
      'Enable it for Production (and Preview if you use it), then trigger a new deployment. ' +
      'On Render, set CORS_ORIGINS to your Vercel URL or *.'
    )
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

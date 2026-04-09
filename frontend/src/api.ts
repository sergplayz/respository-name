/**
 * Local dev: `/api` is proxied to FastAPI (vite.config).
 * Vercel: `/api/*` is handled by `api/[...path].ts`, which forwards to `RENDER_API_URL`.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return p
}

export function friendlyFetchError(message: string): string {
  if (
    message.includes('NOT_FOUND') ||
    message.includes('The page could not be found') ||
    /::[a-z0-9]+-\d+-\d+[a-f0-9]+/i.test(message)
  ) {
    return (
      'Vercel returned 404 for /api (no serverless route). Redeploy after pulling the latest frontend, ' +
      'or set RENDER_API_URL on Vercel so the API proxy can run.'
    )
  }
  if (message.includes('RENDER_API_URL is not set')) {
    return (
      'Set RENDER_API_URL in Vercel → Environment Variables to your Render API base URL ' +
      '(https://your-service.onrender.com, no slash). Enable it for Production and Preview, then redeploy.'
    )
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

/**
 * In dev, leave VITE_API_URL unset so requests use /api and the Vite proxy.
 * On Vercel, set VITE_API_URL to your API origin (e.g. https://matcom-api.onrender.com).
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
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
      'The UI is calling /api on Vercel, but your API lives elsewhere. ' +
      'In Vercel → Project → Settings → Environment Variables, set VITE_API_URL to your backend base URL ' +
      '(example: https://your-service.onrender.com) with no trailing slash, then redeploy. ' +
      'On Render, set CORS_ORIGINS to your Vercel site URL (or * for testing).'
    )
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

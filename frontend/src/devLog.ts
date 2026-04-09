import { useSyncExternalStore } from 'react'

export type DevLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'unhandled' | 'rejection'

export type DevLogEntry = {
  id: number
  t: number
  level: DevLogLevel
  message: string
  detail?: string
}

const MAX = 400
let seq = 0
let entries: DevLogEntry[] = []
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function push(partial: Omit<DevLogEntry, 'id' | 't'> & { t?: number }) {
  const e: DevLogEntry = {
    id: ++seq,
    t: partial.t ?? Date.now(),
    level: partial.level,
    message: partial.message,
    detail: partial.detail,
  }
  const next = [...entries, e]
  entries = next.length > MAX ? next.slice(-MAX) : next
  notify()
}

function argToString(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message
  if (typeof a === 'string') return a
  if (typeof a === 'bigint') return `${a}n`
  if (a === null || a === undefined) return String(a)
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(argToString).join(' ')
}

let installed = false

/** Call once at startup (before React render). Patches console and listens for global errors. */
export function installDevLogCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const wrap = (level: DevLogLevel, orig: (...a: unknown[]) => void) => {
    return (...args: unknown[]) => {
      push({ level, message: formatArgs(args) })
      orig.apply(console, args)
    }
  }

  const consoleLevels = ['log', 'info', 'warn', 'error', 'debug'] as const
  for (const level of consoleLevels) {
    const orig = console[level].bind(console)
    ;(console as unknown as Record<string, (...a: unknown[]) => void>)[level] = wrap(level, orig)
  }

  window.addEventListener('error', (ev) => {
    const err = ev.error
    push({
      level: 'unhandled',
      message: ev.message || 'window error',
      detail:
        err instanceof Error
          ? err.stack
          : [ev.filename, ev.lineno, ev.colno].filter(Boolean).join(':') || undefined,
    })
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    push({
      level: 'rejection',
      message: r instanceof Error ? r.message : String(r),
      detail: r instanceof Error ? r.stack : undefined,
    })
  })
}

/** Record API / UI failures for the admin developer log (user-facing copy stays separate). */
export function logAppEvent(level: 'warn' | 'error', message: string, detail?: string) {
  push({ level, message, detail })
}

export function clearDevLogs() {
  entries = []
  notify()
}

function getSnapshot() {
  return entries
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useDevLogs(): readonly DevLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function devLogsToText(list: readonly DevLogEntry[]): string {
  return list
    .map((e) => {
      const ts = new Date(e.t).toISOString()
      const d = e.detail ? `\n  ${e.detail.split('\n').join('\n  ')}` : ''
      return `[${ts}] ${e.level.toUpperCase()} ${e.message}${d}`
    })
    .join('\n\n')
}

export function getClientAdvancedInfo(): { key: string; value: string }[] {
  const env = import.meta.env
  const vitePairs = Object.keys(env)
    .filter((k) => k.startsWith('VITE_'))
    .sort()
    .map((k) => ({ key: `env.${k}`, value: String((env as Record<string, string>)[k] ?? '') }))

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const href = typeof window !== 'undefined' ? window.location.href : ''

  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const conn = nav && (nav as Navigator & { connection?: { effectiveType?: string } }).connection

  const mem = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory

  const base: { key: string; value: string }[] = [
    { key: 'import.meta.env.MODE', value: env.MODE },
    { key: 'import.meta.env.DEV', value: String(!!env.DEV) },
    { key: 'import.meta.env.PROD', value: String(!!env.PROD) },
    { key: 'import.meta.env.BASE_URL', value: env.BASE_URL },
    { key: 'page origin', value: origin || '—' },
    { key: 'page URL', value: href || '—' },
    { key: 'resolved API example', value: origin ? `${origin}/api/health` : '—' },
    { key: 'navigator.userAgent', value: nav?.userAgent ?? '—' },
    { key: 'navigator.language', value: nav?.language ?? '—' },
    { key: 'navigator.onLine', value: nav ? String(nav.onLine) : '—' },
    { key: 'time zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { key: 'screen', value: typeof screen !== 'undefined' ? `${screen.width}×${screen.height}` : '—' },
    {
      key: 'viewport',
      value: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '—',
    },
    {
      key: 'devicePixelRatio',
      value: typeof window !== 'undefined' ? String(window.devicePixelRatio) : '—',
    },
  ]

  if (conn?.effectiveType) {
    base.push({ key: 'connection.effectiveType', value: conn.effectiveType })
  }

  if (mem?.usedJSHeapSize != null) {
    const mb = (mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)
    base.push({ key: 'performance.memory (Chrome)', value: `~${mb} MB used (heap)` })
  }

  return [...base, ...vitePairs]
}

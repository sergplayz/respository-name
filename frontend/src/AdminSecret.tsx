import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl, readApiJson } from './api'
import {
  clearDevLogs,
  devLogsToText,
  getClientAdvancedInfo,
  logAppEvent,
  useDevLogs,
} from './devLog'

/**
 * Hidden ops panel: open only at /admiralscoob2 (bookmark your-site.vercel.app/admiralscoob2).
 * No login — security is only the unlisted URL (obscurity). Public /api/health only for DB line.
 */
const ADMIN_PANEL_PATH = '/admiralscoob2'

function normalizePathname(): string {
  const p = window.location.pathname.replace(/\/$/, '') || '/'
  return p
}

function pathOpensAdmin(): boolean {
  return normalizePathname() === ADMIN_PANEL_PATH
}

type Health = { ok?: boolean }

type LatencyRow = {
  label: string
  path: string
  ms: number | null
  status: number | null
  error?: string
}

export function AdminSecret() {
  const [panelOpen, setPanelOpen] = useState(() =>
    typeof window !== 'undefined' ? pathOpensAdmin() : false,
  )
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [latency, setLatency] = useState<LatencyRow[]>([])
  const [loadingLatency, setLoadingLatency] = useState(false)

  const devLogs = useDevLogs()
  const advancedRows = useMemo(() => getClientAdvancedInfo(), [panelOpen])

  useEffect(() => {
    const onPop = () => setPanelOpen(pathOpensAdmin())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    if (pathOpensAdmin()) {
      window.history.replaceState(null, '', '/')
    }
  }, [])

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true)
    setHealthErr(null)
    try {
      const res = await fetch(apiUrl('/api/health'))
      setHealth(await readApiJson<Health>(res))
    } catch (e) {
      setHealth(null)
      const msg = e instanceof Error ? e.message : 'Request failed'
      setHealthErr(msg)
      logAppEvent('error', 'Admin: health check failed', msg)
    } finally {
      setLoadingHealth(false)
    }
  }, [])

  const loadLatencies = useCallback(async () => {
    setLoadingLatency(true)
    const out: LatencyRow[] = []

    const timed = async (label: string, path: string) => {
      const t0 = performance.now()
      try {
        const res = await fetch(apiUrl(path))
        const ms = Math.round(performance.now() - t0)
        const errText = res.ok ? undefined : (await res.text()).slice(0, 160)
        out.push({ label, path, ms, status: res.status, error: errText })
        return res
      } catch (e) {
        const ms = Math.round(performance.now() - t0)
        out.push({
          label,
          path,
          ms,
          status: null,
          error: e instanceof Error ? e.message : 'failed',
        })
        return null
      }
    }

    await timed('GET /api/health', '/api/health')
    const tablesRes = await timed('GET /api/tables', '/api/tables')

    const tableNames: string[] = []
    if (tablesRes?.ok) {
      try {
        const d = (await tablesRes.clone().json()) as { tables?: { name: string }[] }
        tableNames.push(...(d.tables?.map((t) => t.name).filter(Boolean) ?? []))
      } catch {
        /* ignore */
      }
    }

    if (tableNames.length) {
      let rowsOk = false
      for (const name of tableNames) {
        const path = `/api/tables/${encodeURIComponent(name)}/rows?limit=1&skip=0`
        const t0 = performance.now()
        try {
          const res = await fetch(apiUrl(path))
          const ms = Math.round(performance.now() - t0)
          const errText = res.ok ? undefined : (await res.text()).slice(0, 160)
          out.push({
            label: 'GET /api/tables/{name}/rows',
            path,
            ms,
            status: res.status,
            error: errText,
          })
          if (res.ok) {
            rowsOk = true
            break
          }
        } catch (e) {
          const ms = Math.round(performance.now() - t0)
          out.push({
            label: 'GET /api/tables/{name}/rows',
            path,
            ms,
            status: null,
            error: e instanceof Error ? e.message : 'failed',
          })
        }
      }
      if (!rowsOk && tableNames.length) {
        out.push({
          label: 'GET /api/tables/{name}/rows (note)',
          path: '—',
          ms: null,
          status: null,
          error: `No row endpoint succeeded; tried ${tableNames.length} table(s) from /api/tables.`,
        })
      }
    } else {
      out.push({
        label: 'GET /api/tables/{name}/rows',
        path: '(skipped)',
        ms: null,
        status: null,
        error: 'No table returned from /api/tables',
      })
    }

    await timed('GET /api/search', '/api/search?q=a&per_table=1')

    setLatency(out)
    const bad = out.filter((r) => r.error)
    if (bad.length) {
      logAppEvent(
        'warn',
        `Admin: ${bad.length} latency probe(s) reported errors`,
        bad.map((r) => `${r.label} (${r.status ?? '—'}): ${r.error}`).join('\n'),
      )
    }
    setLoadingLatency(false)
  }, [])

  useEffect(() => {
    if (panelOpen) {
      void loadHealth()
      void loadLatencies()
    }
  }, [panelOpen, loadHealth, loadLatencies])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePanel])

  if (!panelOpen) {
    return null
  }

  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onClick={closePanel}
    >
      <div
        className="admin-modal admin-modal-extra"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="admin-panel-title" className="admin-modal-title">
          Ops panel
        </h2>
        <p className="admin-panel-note">
          Hidden URL only — no password. Anyone who knows <code className="admin-inline-code">{ADMIN_PANEL_PATH}</code>{' '}
          can open this. Round-trip time in ms for public API routes; first request may include host wake-up.
        </p>

        <h3 className="admin-section-title">Endpoint latency</h3>
        {loadingLatency && <p className="loading">Measuring…</p>}
        {!loadingLatency && (
          <div className="admin-latency-wrap">
            <table className="admin-latency-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Path</th>
                  <th>HTTP</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {latency.map((row) => (
                  <tr key={row.label + row.path}>
                    <td>{row.label}</td>
                    <td className="admin-latency-path">{row.path}</td>
                    <td>{row.status ?? '—'}</td>
                    <td>{row.ms ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {latency.some((r) => r.error) && (
              <ul className="admin-latency-errors">
                {latency
                  .filter((r) => r.error)
                  .map((r) => (
                    <li key={r.label + (r.path ?? '')}>
                      <span className="admin-k">{r.label}</span> {r.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="button"
          className="btn secondary admin-refresh-latency"
          onClick={() => void loadLatencies()}
          disabled={loadingLatency}
        >
          Re-run latency
        </button>

        <h3 className="admin-section-title">API health</h3>
        <div className="admin-panel-body">
          {loadingHealth && <p className="loading">Loading…</p>}
          {healthErr && <div className="error">{healthErr}</div>}
          {health && !loadingHealth && (
            <ul className="admin-health-list">
              <li>
                <span className="admin-k">ok</span> {String(health.ok)}
              </li>
            </ul>
          )}
          <button type="button" className="btn secondary" onClick={() => void loadHealth()}>
            Refresh health
          </button>
        </div>

        <h3 className="admin-section-title">Developer log</h3>
        <p className="admin-panel-note">
          Console output (log / warn / error / debug), uncaught exceptions, promise rejections, and app
          API errors. Newest at the bottom. Up to 400 lines kept in memory only.
        </p>
        <div className="admin-dev-log-toolbar">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(devLogsToText(devLogs))
            }}
            disabled={!devLogs.length}
          >
            Copy all
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => clearDevLogs()}
            disabled={!devLogs.length}
          >
            Clear
          </button>
        </div>
        <div className="admin-dev-log" role="log" aria-live="polite">
          {!devLogs.length && <p className="admin-dev-log-empty">No entries yet.</p>}
          {devLogs.map((e) => (
            <div
              key={e.id}
              className={`admin-dev-log-line admin-dev-log-${e.level === 'log' || e.level === 'info' || e.level === 'debug' ? 'muted' : e.level === 'warn' ? 'warn' : 'err'}`}
            >
              <span className="admin-dev-log-ts">
                {new Date(e.t).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              <span className="admin-dev-log-lvl">{e.level}</span>
              <span className="admin-dev-log-msg">{e.message}</span>
              {e.detail && <pre className="admin-dev-log-detail">{e.detail}</pre>}
            </div>
          ))}
        </div>

        <h3 className="admin-section-title">Advanced (client)</h3>
        <p className="admin-panel-note">
          Build mode, public Vite env keys, and browser context. No server secrets.
        </p>
        <div className="admin-advanced-toolbar">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const text = advancedRows.map((r) => `${r.key}: ${r.value}`).join('\n')
              void navigator.clipboard?.writeText(text)
            }}
          >
            Copy as text
          </button>
        </div>
        <dl className="admin-advanced-dl">
          {advancedRows.map((row) => (
            <div key={row.key} className="admin-advanced-row">
              <dt>{row.key}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="admin-modal-actions admin-modal-footer">
          <button type="button" className="btn" onClick={closePanel}>
            Back to lookup
          </button>
        </div>
      </div>
    </div>
  )
}

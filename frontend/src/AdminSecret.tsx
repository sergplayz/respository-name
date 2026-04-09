import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl } from './api'
import {
  clearDevLogs,
  devLogsToText,
  getClientAdvancedInfo,
  logAppEvent,
  useDevLogs,
} from './devLog'

/**
 * Hidden entry. Admin sign-in is verified on the API (bcrypt + JWT). No passwords in the bundle
 * or localStorage — only a short-lived bearer token in sessionStorage.
 */
const TOKEN_KEY = 'matcom_admin_token'

type Health = { ok?: boolean }

type DbStatus = { ok?: boolean; database_reachable?: boolean }

type LatencyRow = {
  label: string
  path: string
  ms: number | null
  status: number | null
  error?: string
}

function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function AdminSecret() {
  const [session, setSession] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [latency, setLatency] = useState<LatencyRow[]>([])
  const [loadingLatency, setLoadingLatency] = useState(false)

  const devLogs = useDevLogs()
  const advancedRows = useMemo(() => getClientAdvancedInfo(), [panelOpen])

  useEffect(() => {
    setSession(getToken() !== null)
  }, [])

  const clearAdminSession = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
    setSession(false)
  }, [])

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true)
    setHealthErr(null)
    try {
      const res = await fetch(apiUrl('/api/health'))
      if (!res.ok) throw new Error(await res.text())
      setHealth((await res.json()) as Health)

      const token = getToken()
      if (token) {
        const ds = await fetch(apiUrl('/api/admin/db-status'), {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (ds.status === 401) {
          clearAdminSession()
          setDbStatus(null)
          setHealthErr('Session expired. Sign in again.')
          return
        }
        if (!ds.ok) {
          setDbStatus(null)
          const t = await ds.text()
          throw new Error(t || `HTTP ${ds.status}`)
        }
        setDbStatus((await ds.json()) as DbStatus)
      } else {
        setDbStatus(null)
      }
    } catch (e) {
      setHealth(null)
      setDbStatus(null)
      const msg = e instanceof Error ? e.message : 'Request failed'
      setHealthErr(msg)
      logAppEvent('error', 'Admin: health check failed', msg)
    } finally {
      setLoadingHealth(false)
    }
  }, [clearAdminSession])

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
    if (panelOpen && session) {
      void loadHealth()
      void loadLatencies()
    }
  }, [panelOpen, session, loadHealth, loadLatencies])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLoginOpen(false)
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openFromCorner = () => {
    setLoginError('')
    if (session) {
      setPanelOpen(true)
    } else {
      setUser('')
      setPass('')
      setLoginOpen(true)
    }
  }

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    try {
      const res = await fetch(apiUrl('/api/admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.trim(), password: pass }),
      })
      const raw = await res.text()
      if (res.status === 503) {
        setLoginError(
          'Server admin sign-in is not configured. Set MATCOM_ADMIN_USERNAME, MATCOM_ADMIN_PASSWORD_BCRYPT, and MATCOM_JWT_SECRET on the API.',
        )
        return
      }
      if (!res.ok) {
        let detail = raw
        try {
          const j = JSON.parse(raw) as { detail?: unknown }
          if (typeof j.detail === 'string') detail = j.detail
        } catch {
          /* use raw */
        }
        setLoginError(detail || 'Sign-in failed')
        return
      }
      const data = JSON.parse(raw) as { access_token?: string }
      if (!data.access_token) {
        setLoginError('Invalid response from server.')
        return
      }
      sessionStorage.setItem(TOKEN_KEY, data.access_token)
      setSession(true)
      setLoginOpen(false)
      setPass('')
      setPanelOpen(true)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Network error')
    }
  }

  const logout = () => {
    clearAdminSession()
    setPanelOpen(false)
    setHealth(null)
    setDbStatus(null)
    setLatency([])
  }

  return (
    <>
      <div
        className="admin-corner-hit"
        onClick={openFromCorner}
        aria-hidden="true"
      />

      {loginOpen && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => setLoginOpen(false)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-login-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="admin-login-title" className="admin-modal-title">
              Sign in
            </h2>
            <p className="admin-login-hint">
              Use the username and password configured on the API server (environment variables), not
              a password stored in this browser.
            </p>
            <form onSubmit={submitLogin} className="admin-form">
              <label className="admin-label">
                Username
                <input
                  className="admin-input"
                  autoComplete="username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                />
              </label>
              <label className="admin-label">
                Password
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
              </label>
              {loginError && <p className="admin-login-error">{loginError}</p>}
              <div className="admin-modal-actions">
                <button type="button" className="btn secondary" onClick={() => setLoginOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn">
                  Enter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {panelOpen && session && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => setPanelOpen(false)}
        >
          <div
            className="admin-modal admin-modal-extra"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-panel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="admin-panel-title" className="admin-modal-title">
              Admin
            </h2>
            <p className="admin-panel-note">
              Signed in with server-issued token (session only). Round-trip time in ms for each public
              API route. If the API host was asleep (e.g. free tier), the first line can include full
              wake time; rerun after a few seconds to see steady-state latency.
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
                  {dbStatus && (
                    <li>
                      <span className="admin-k">database reachable</span>{' '}
                      {String(dbStatus.database_reachable)}
                    </li>
                  )}
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
              <button type="button" className="btn secondary" onClick={logout}>
                Log out
              </button>
              <button type="button" className="btn" onClick={() => setPanelOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

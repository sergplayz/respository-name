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
 * Hidden entry + client-only “login”. Credentials and overrides live in the browser bundle
 * and localStorage. Not real security.
 */
const SESSION_KEY = 'matcom_admin_session'
const CREDS_KEY = 'matcom_admin_creds'
const DEFAULT_USER = 'milda107'
const DEFAULT_PASS = 'suspended'

type Health = { ok?: boolean; database?: string; exists?: boolean }

type LatencyRow = {
  label: string
  path: string
  ms: number | null
  status: number | null
  error?: string
}

function getEffectiveCreds(): { user: string; pass: string } {
  try {
    const raw = localStorage.getItem(CREDS_KEY)
    if (!raw) return { user: DEFAULT_USER, pass: DEFAULT_PASS }
    const j = JSON.parse(raw) as { user?: unknown; pass?: unknown }
    if (typeof j.user === 'string' && typeof j.pass === 'string') {
      return { user: j.user, pass: j.pass }
    }
  } catch {
    /* ignore */
  }
  return { user: DEFAULT_USER, pass: DEFAULT_PASS }
}

function usingCustomCreds(): boolean {
  return localStorage.getItem(CREDS_KEY) !== null
}

export function AdminSecret() {
  const [session, setSession] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [latency, setLatency] = useState<LatencyRow[]>([])
  const [loadingLatency, setLoadingLatency] = useState(false)

  const devLogs = useDevLogs()
  const advancedRows = useMemo(() => getClientAdvancedInfo(), [panelOpen])

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [credMessage, setCredMessage] = useState('')
  const [credError, setCredError] = useState('')

  useEffect(() => {
    setSession(sessionStorage.getItem(SESSION_KEY) === '1')
  }, [])

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true)
    setHealthErr(null)
    try {
      const res = await fetch(apiUrl('/api/health'))
      if (!res.ok) throw new Error(await res.text())
      setHealth((await res.json()) as Health)
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

    let firstTable = ''
    if (tablesRes?.ok) {
      try {
        const d = (await tablesRes.json()) as { tables?: { name: string }[] }
        firstTable = d.tables?.[0]?.name ?? ''
      } catch {
        /* ignore */
      }
    }

    if (firstTable) {
      const path = `/api/tables/${encodeURIComponent(firstTable)}/rows?limit=1&skip=0`
      await timed(`GET /api/tables/{name}/rows`, path)
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

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    const c = getEffectiveCreds()
    if (user === c.user && pass === c.pass) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setSession(true)
      setLoginOpen(false)
      setPass('')
      setPanelOpen(true)
    } else {
      setLoginError('Wrong username or password.')
    }
  }

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setSession(false)
    setPanelOpen(false)
    setHealth(null)
    setLatency([])
  }

  const saveNewCreds = (e: React.FormEvent) => {
    e.preventDefault()
    setCredMessage('')
    setCredError('')
    if (!newUser.trim()) {
      setCredError('Username cannot be empty.')
      return
    }
    if (!newPass) {
      setCredError('Password cannot be empty.')
      return
    }
    if (newPass !== newPass2) {
      setCredError('Passwords do not match.')
      return
    }
    localStorage.setItem(CREDS_KEY, JSON.stringify({ user: newUser.trim(), pass: newPass }))
    setCredMessage('Saved. Use this username and password the next time you sign in.')
    setNewPass('')
    setNewPass2('')
  }

  const resetCreds = () => {
    localStorage.removeItem(CREDS_KEY)
    setCredMessage('Restored built-in defaults (milda107 / suspended).')
    setCredError('')
    setNewUser('')
    setNewPass('')
    setNewPass2('')
  }

  const effective = getEffectiveCreds()
  const custom = usingCustomCreds()

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
              {custom ? 'Using saved custom credentials.' : 'Using built-in defaults until you change them in the admin panel.'}
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
              Active login: <strong>{effective.user}</strong>
              {custom ? ' (custom)' : ' (default)'} · Round-trip time in ms for each public API route.
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
                        <li key={r.label}>
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
                  <li>
                    <span className="admin-k">database path</span> {health.database ?? '—'}
                  </li>
                  <li>
                    <span className="admin-k">file exists</span> {String(health.exists)}
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

            <h3 className="admin-section-title">Change login</h3>
            <p className="admin-panel-note">
              Stored in this browser only (localStorage). Reset returns to milda107 / suspended.
            </p>
            <form onSubmit={saveNewCreds} className="admin-form">
              <label className="admin-label">
                New username
                <input
                  className="admin-input"
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="admin-label">
                New password
                <input
                  className="admin-input"
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="admin-label">
                Confirm password
                <input
                  className="admin-input"
                  type="password"
                  value={newPass2}
                  onChange={(e) => setNewPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              {credError && <p className="admin-login-error">{credError}</p>}
              {credMessage && <p className="admin-cred-ok">{credMessage}</p>}
              <div className="admin-modal-actions admin-modal-actions-left">
                <button type="submit" className="btn">
                  Save credentials
                </button>
                <button type="button" className="btn secondary" onClick={resetCreds}>
                  Reset to defaults
                </button>
              </div>
            </form>

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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl, friendlyFetchError } from './api'
import { logAppEvent } from './devLog'
import type { ColumnInfo, TableSummary } from './matcomTypes'
import { fetchTablesOnce } from './tablesClient'
import { AdminSecret } from './AdminSecret'
import './App.css'

type RowsResponse = {
  table: string
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  total: number
  skip: number
  limit: number
}

type SearchHit = {
  table: string
  label: string
  rows: Record<string, unknown>[]
  columns: ColumnInfo[]
}

type SearchResponse = { query: string; hits: SearchHit[] }

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return String(value)
}

function columnHeader(c: ColumnInfo): string {
  const d = c.displayName?.trim()
  if (d) return d
  const n = c.name.trim()
  return n || '(unnamed)'
}

function DataTable({
  columns,
  rows,
}: {
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
}) {
  if (!columns.length) {
    return <p className="empty">No columns in this table.</p>
  }
  if (!rows.length) {
    return <p className="empty">No rows match the current filter.</p>
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.name}
                title={c.displayName ? `${c.displayName} (${c.name.trim() || 'column'})` : c.name}
              >
                {columnHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const n = c.name
                const text = formatCell(row[n])
                return (
                  <td key={n} title={text.length > 80 ? text : undefined}>
                    {text || '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<'browse' | 'search'>('browse')
  const [tables, setTables] = useState<TableSummary[]>([])
  const [tablesError, setTablesError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const [filterInput, setFilterInput] = useState('')
  const [debouncedFilter, setDebouncedFilter] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const [rowsData, setRowsData] = useState<RowsResponse | null>(null)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState<string | null>(null)

  const [globalInput, setGlobalInput] = useState('')
  const [globalResult, setGlobalResult] = useState<SearchResponse | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedFilter(filterInput), 320)
    return () => window.clearTimeout(t)
  }, [filterInput])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setTablesError(null)
      try {
        const tables = await fetchTablesOnce()
        if (cancelled) return
        setTables(tables)
        setSelected((prev) => prev ?? tables[0]?.name ?? null)
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load tables'
          const friendly = friendlyFetchError(msg)
          setTablesError(friendly)
          logAppEvent('error', 'Failed to load /api/tables', friendly)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPage(0)
  }, [debouncedFilter, selected])

  useEffect(() => {
    if (view !== 'browse' || !selected) return
    let cancelled = false
    ;(async () => {
      setRowsLoading(true)
      setRowsError(null)
      try {
        const params = new URLSearchParams({
          skip: String(page * pageSize),
          limit: String(pageSize),
        })
        const q = debouncedFilter.trim()
        if (q) params.set('q', q)
        const res = await fetch(
          apiUrl(`/api/tables/${encodeURIComponent(selected)}/rows?${params}`),
        )
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as RowsResponse
        if (!cancelled) setRowsData(data)
      } catch (e) {
        if (!cancelled) {
          setRowsData(null)
          const msg = e instanceof Error ? e.message : 'Failed to load rows'
          const friendly = friendlyFetchError(msg)
          setRowsError(friendly)
          logAppEvent('error', `Failed to load rows: ${selected}`, friendly)
        }
      } finally {
        if (!cancelled) setRowsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view, selected, page, debouncedFilter, pageSize])

  const runGlobalSearch = useCallback(async () => {
    const q = globalInput.trim()
    if (!q) return
    setGlobalLoading(true)
    setGlobalError(null)
    try {
      const params = new URLSearchParams({ q, per_table: '12' })
      const res = await fetch(apiUrl(`/api/search?${params}`))
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as SearchResponse
      setGlobalResult(data)
    } catch (e) {
      setGlobalResult(null)
      const msg = e instanceof Error ? e.message : 'Search failed'
      const friendly = friendlyFetchError(msg)
      setGlobalError(friendly)
      logAppEvent('error', 'Global search failed', friendly)
    } finally {
      setGlobalLoading(false)
    }
  }, [globalInput])

  const selectedMeta = useMemo(
    () => tables.find((t) => t.name === selected),
    [tables, selected],
  )

  const totalPages =
    rowsData && rowsData.total > 0
      ? Math.max(1, Math.ceil(rowsData.total / pageSize))
      : 1

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>MATCOM Lookup</h1>
          <p>
            Pick a table on the left to load it here. The search field under the sheet name filters what
            you see and looks at every column on that table only. If the list is long, use Previous and
            Next at the bottom.
          </p>
          <p>
            Want to scan everything at once? Click Search all, then type your EXACT username in the box
            on the right.
          </p>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={view === 'browse' ? 'active' : ''}
            onClick={() => setView('browse')}
          >
            Tables
          </button>
          <button
            type="button"
            className={view === 'search' ? 'active' : ''}
            onClick={() => setView('search')}
          >
            Search all
          </button>
        </div>
        {view === 'browse' && (
          <>
            {tablesError && <div className="error">{tablesError}</div>}
            <ul className="table-list">
              {tables.map((t) => (
                <li key={t.name}>
                  <button
                    type="button"
                    className={t.name === selected ? 'selected' : ''}
                    onClick={() => setSelected(t.name)}
                  >
                    <span className="label">{t.label}</span>
                    <span className="meta">
                      {t.rowCount.toLocaleString()} rows · {t.columns.length} columns
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="main">
        {view === 'browse' && (
          <>
            <div className="toolbar">
              <h2>{selectedMeta?.label ?? 'Select a table'}</h2>
              <div className="search-field">
                <input
                  type="search"
                  placeholder="Filter rows (any column)…"
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  aria-label="Filter current table"
                />
              </div>
            </div>
            {rowsError && <div className="error">{rowsError}</div>}
            {rowsLoading && <p className="loading">Loading…</p>}
            {!rowsLoading && rowsData && (
              <>
                <div className="pager" style={{ marginBottom: '0.75rem' }}>
                  <span>
                    Showing{' '}
                    <strong style={{ color: 'var(--heading)' }}>
                      {rowsData.total.toLocaleString()}
                    </strong>{' '}
                    matching rows
                    {debouncedFilter.trim() ? ` for “${debouncedFilter.trim()}”` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
                <DataTable columns={rowsData.columns} rows={rowsData.rows} />
              </>
            )}
          </>
        )}

        {view === 'search' && (
          <>
            <div className="toolbar">
              <h2>Search all tables</h2>
            </div>
            <form
              className="global-search-form"
              onSubmit={(e) => {
                e.preventDefault()
                void runGlobalSearch()
              }}
            >
              <input
                type="search"
                placeholder="Username, rank, roster text…"
                value={globalInput}
                onChange={(e) => setGlobalInput(e.target.value)}
                aria-label="Search all tables"
              />
              <button type="submit" className="btn" disabled={globalLoading}>
                {globalLoading ? 'Searching…' : 'Search'}
              </button>
            </form>
            {globalError && <div className="error">{globalError}</div>}
            {globalResult && !globalResult.hits.length && (
              <p className="empty">No matches for “{globalResult.query}”.</p>
            )}
            {globalResult?.hits.map((h) => (
              <section key={h.table} className="search-all-section">
                <h3>
                  {h.label}{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                    ({h.table})
                  </span>
                </h3>
                <DataTable columns={h.columns} rows={h.rows} />
              </section>
            ))}
            <p className="hint">
              Each table shows up to 12 matching rows. Open “Tables” and pick a sheet for full paging.
            </p>
          </>
        )}
      </main>
      <AdminSecret />
    </div>
  )
}

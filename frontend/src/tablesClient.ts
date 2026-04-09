import { apiUrl } from './api'
import type { TableSummary } from './matcomTypes'

/** One in-flight request so React StrictMode (dev) does not double-hit /api/tables. */
let tablesInFlight: Promise<TableSummary[]> | null = null

export async function fetchTablesOnce(): Promise<TableSummary[]> {
  if (!tablesInFlight) {
    tablesInFlight = (async () => {
      const res = await fetch(apiUrl('/api/tables'))
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { tables: TableSummary[] }
      return data.tables
    })().finally(() => {
      tablesInFlight = null
    })
  }
  return tablesInFlight
}

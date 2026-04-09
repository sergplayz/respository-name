import { apiUrl, readApiJson } from './api'
import type { TableSummary } from './matcomTypes'

/** One in-flight request so React StrictMode (dev) does not double-hit /api/tables. */
let tablesInFlight: Promise<TableSummary[]> | null = null

export async function fetchTablesOnce(): Promise<TableSummary[]> {
  if (!tablesInFlight) {
    tablesInFlight = (async () => {
      const res = await fetch(apiUrl('/api/tables'))
      const data = await readApiJson<{ tables: TableSummary[] }>(res)
      return data.tables
    })().finally(() => {
      tablesInFlight = null
    })
  }
  return tablesInFlight
}

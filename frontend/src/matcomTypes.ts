export type ColumnInfo = {
  cid: number
  name: string
  type: string
  pk: boolean
  displayName?: string
}

export type TableSummary = {
  name: string
  label: string
  rowCount: number
  columns: ColumnInfo[]
}

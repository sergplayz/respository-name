/// <reference types="vite/client" />

/** Injected in vite.config.ts via `define` (empty string in local dev → use /api proxy). */
declare const __API_ORIGIN__: string

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly RENDER_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

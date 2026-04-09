/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production API origin, e.g. https://your-api.onrender.com (no trailing slash). */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

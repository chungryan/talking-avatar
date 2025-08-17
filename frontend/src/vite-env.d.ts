/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_ANIMATOR_BASE: string
  readonly VITE_ASSETS_BUCKET: string
}
interface ImportMeta { readonly env: ImportMetaEnv }

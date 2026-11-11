/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' only for a build served by the local Mac server (`vite preview`), enabling /__local-book/* features. */
  readonly VITE_CBT_LOCAL_SERVER?: string;
  /** 'true' to register the offline service worker. Unset by default. */
  readonly VITE_CBT_ENABLE_SW?: string;
}

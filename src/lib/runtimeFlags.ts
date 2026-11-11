type RuntimeEnv = { DEV?: boolean; PROD?: boolean; VITE_CBT_LOCAL_SERVER?: string; VITE_CBT_ENABLE_SW?: string };

/** Local Mac server endpoints (/__local-book/*) exist in the dev server and in a local `vite preview` candidate. */
export function localServerFeaturesEnabled(env: RuntimeEnv): boolean {
  return env.DEV === true || env.VITE_CBT_LOCAL_SERVER === 'true';
}

/** The offline service worker stays built but unregistered unless a build explicitly opts in. */
export function serviceWorkerRegistrationEnabled(env: RuntimeEnv): boolean {
  return env.PROD === true && env.VITE_CBT_ENABLE_SW === 'true' && env.VITE_CBT_LOCAL_SERVER !== 'true';
}

export const LOCAL_SERVER_FEATURES = localServerFeaturesEnabled(import.meta.env);
export const SERVICE_WORKER_ENABLED = serviceWorkerRegistrationEnabled(import.meta.env);

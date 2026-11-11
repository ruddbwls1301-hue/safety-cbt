import { describe, expect, it } from 'vitest';
import { localServerFeaturesEnabled, serviceWorkerRegistrationEnabled, SERVICE_WORKER_ENABLED } from './runtimeFlags';

describe('runtime flags', () => {
  it('keeps the service worker unregistered unless a production build explicitly opts in', () => {
    expect(serviceWorkerRegistrationEnabled({ DEV: true, PROD: false })).toBe(false);
    expect(serviceWorkerRegistrationEnabled({ DEV: false, PROD: true })).toBe(false);
    expect(serviceWorkerRegistrationEnabled({ DEV: false, PROD: true, VITE_CBT_LOCAL_SERVER: 'true' })).toBe(false);
    expect(serviceWorkerRegistrationEnabled({ DEV: false, PROD: true, VITE_CBT_ENABLE_SW: 'false' })).toBe(false);
    expect(serviceWorkerRegistrationEnabled({ DEV: false, PROD: true, VITE_CBT_ENABLE_SW: 'true' })).toBe(true);
    expect(serviceWorkerRegistrationEnabled({ DEV: false, PROD: true, VITE_CBT_ENABLE_SW: 'true', VITE_CBT_LOCAL_SERVER: 'true' })).toBe(false);
    expect(serviceWorkerRegistrationEnabled({ DEV: true, PROD: false, VITE_CBT_ENABLE_SW: 'true' })).toBe(false);
    expect(SERVICE_WORKER_ENABLED).toBe(false);
  });
  it('enables local Mac server features in dev and in an explicitly flagged local preview build only', () => {
    expect(localServerFeaturesEnabled({ DEV: true })).toBe(true);
    expect(localServerFeaturesEnabled({ DEV: false, PROD: true })).toBe(false);
    expect(localServerFeaturesEnabled({ DEV: false, PROD: true, VITE_CBT_LOCAL_SERVER: 'true' })).toBe(true);
    expect(localServerFeaturesEnabled({ DEV: false, PROD: true, VITE_CBT_LOCAL_SERVER: '1' })).toBe(false);
  });
});

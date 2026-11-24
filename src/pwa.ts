/**
 * Offline support: registers the service worker built by vite-plugin-pwa and
 * reports when a new version is waiting. Skipped where a service worker cannot
 * or should not run (inside an iframe preview, or on plain http).
 */
import { registerSW } from 'virtual:pwa-register';

export type PwaEvents = { onNeedRefresh: (update: () => void) => void; onOfflineReady: () => void };

export function startPwa(events: PwaEvents): void {
  if (!('serviceWorker' in navigator)) return;
  if (window.self !== window.top) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  const update = registerSW({
    onNeedRefresh: () => events.onNeedRefresh(() => update(true)),
    onOfflineReady: () => events.onOfflineReady(),
  });
}

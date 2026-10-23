import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` every few seconds while `active` is true, so a page showing
 * work that is still happening on the server (the AI scoring an application)
 * updates by itself.
 *
 * It pauses while the browser tab is hidden and gives up after `maxTicks`
 * calls, so a job that never finishes cannot keep polling the server forever.
 *
 * @param {boolean} active - Poll only while this is true.
 * @param {() => void} refresh - Reloads the data. The latest version is always used.
 * @param {{ intervalMs?: number, maxTicks?: number }} [options]
 */
export default function useRefreshWhile(active, refresh, { intervalMs = 5000, maxTicks = 120 } = {}) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) return undefined;
    let ticks = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      ticks += 1;
      if (ticks > maxTicks) {
        window.clearInterval(timer);
        return;
      }
      Promise.resolve(refreshRef.current()).catch(() => { /* the API client already reports errors */ });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, maxTicks]);
}

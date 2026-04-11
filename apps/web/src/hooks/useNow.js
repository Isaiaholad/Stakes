import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api.js';

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  const [offsetMs, setOffsetMs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const syncChainTime = async () => {
      try {
        const payload = await fetchJson('/time/chain');
        if (!cancelled && Number.isFinite(payload?.offsetMs)) {
          setOffsetMs(payload.offsetMs);
        }
      } catch {
        // Fall back to local time when the indexed API is still booting.
      }
    };

    syncChainTime();
    const syncTimer = window.setInterval(syncChainTime, 60_000);
    const timer = window.setInterval(() => {
      setNow(Date.now() + offsetMs);
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
      window.clearInterval(timer);
    };
  }, [intervalMs, offsetMs]);

  useEffect(() => {
    setNow(Date.now() + offsetMs);
  }, [offsetMs]);

  return now;
}

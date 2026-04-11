import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJson = vi.fn();

vi.mock('../lib/api.js', () => ({
  fetchJson
}));

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));
    fetchJson.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tracks chain time using the indexed API offset instead of raw local Date.now', async () => {
    fetchJson.mockResolvedValue({
      offsetMs: 5_000
    });

    const { useNow } = await import('./useNow.js');
    const { result } = renderHook(() => useNow(1_000));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchJson).toHaveBeenCalledWith('/time/chain');
    expect(result.current).toBe(new Date('2026-03-28T12:00:05.000Z').getTime());

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(result.current).toBe(new Date('2026-03-28T12:00:07.000Z').getTime());
  });
});

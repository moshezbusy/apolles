import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_EVERY_MS, refreshEvery } from "./pending-refresh";

describe("refreshEvery (the booking page while it waits for the hotel)", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes every 15 seconds, only while the tab is visible, and stops when told to", () => {
    vi.useFakeTimers();
    expect(REFRESH_EVERY_MS).toBe(15_000);
    const refresh = vi.fn();
    let visible = true;
    const stop = refreshEvery(refresh, () => visible);
    vi.advanceTimersByTime(14_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    visible = false; // a tab in the background asks for nothing
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    visible = true;
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});

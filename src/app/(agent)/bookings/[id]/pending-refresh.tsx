"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const REFRESH_EVERY_MS = 15_000;

// Calls `refresh` every 15 seconds while the tab is visible. Returns how to stop.
export function refreshEvery(refresh: () => void, isVisible: () => boolean, everyMs: number = REFRESH_EVERY_MS): () => void {
  const timer = setInterval(() => {
    if (isVisible()) refresh();
  }, everyMs);
  return () => clearInterval(timer);
}

// On the booking page while the booking (or its cancellation) waits for the hotel: the page
// reads the booking again every 15 seconds, so the result shows without a reload. It is only
// rendered for a waiting booking, so it stops by itself once the result is in.
export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => refreshEvery(() => router.refresh(), () => document.visibilityState === "visible"), [router]);
  return <span hidden data-refresh-every={REFRESH_EVERY_MS / 1000} />;
}

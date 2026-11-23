// Next.js calls register() once when a server starts (not for each request). The only thing
// done here is the start-up safety check: a production build with a wrong or incomplete
// environment stops at once with a clear list, instead of running in the wrong mode
// (src/server/startup-check.ts).
//
// `next build` also loads this file while it renders pages; nothing is checked then (the
// build machine has no run-time settings), nor in the edge runtime (no process to stop).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { refuseToStartOnBadEnv } = await import("@/server/startup-check");
  refuseToStartOnBadEnv();
}

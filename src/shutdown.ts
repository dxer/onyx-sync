/**
 * Graceful shutdown for the single-node server (see `src/entry-node.ts`).
 *
 * Sequence: stop accepting new connections → close live WebSockets (clients
 * reconnect) → WAL checkpoint + close SQLite → exit. A grace timer forces
 * the exit so a hung connection can never block deploys forever.
 *
 * `exit` is injected (process.exit in production, captured in tests).
 */

export interface ShutdownDeps {
  log: (message: string) => void;
  /** Resolves once the HTTP server stops accepting connections. */
  closeServer: () => Promise<void>;
  /** Closes every live WebSocket with a going-away code. */
  closeSockets: (code: number, reason: string) => void;
  /** WAL checkpoint + store close (SQLite); no-op on stores without one. */
  checkpointAndClose: () => Promise<void> | void;
  timeoutMs: number;
  exit: (code: number) => void;
}

export function createShutdownHandler(deps: ShutdownDeps): () => void {
  let shuttingDown = false;

  return () => {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.log('[Shutdown] Signal received, draining connections...');

    const force = setTimeout(() => {
      deps.log('[Shutdown] Grace period expired, forcing exit');
      deps.exit(1);
    }, Math.max(1_000, deps.timeoutMs));

    void (async () => {
      try {
        await deps.closeServer();
        deps.closeSockets(1001, 'server shutting down');
        await deps.checkpointAndClose();
        clearTimeout(force);
        deps.log('[Shutdown] Clean exit');
        deps.exit(0);
      } catch (error) {
        clearTimeout(force);
        deps.log(`[Shutdown] Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        deps.exit(1);
      }
    })();
  };
}

import { normalizePath, type App, type EventRef, type TAbstractFile } from 'obsidian';

export interface VaultChangeBatch {
  dirty: Set<string>;
  deleted: Set<string>;
  renamed: Array<{ oldPath: string; newPath: string }>;
}

/**
 * Folds a rename into an outstanding rename map so chains collapse onto a
 * single move: a→b followed by b→c becomes a→c, and a→b followed by b→a
 * cancels out.
 */
export function foldRename(map: Map<string, string>, oldPath: string, newPath: string): void {
  if (map.get(newPath) === oldPath) {
    map.delete(newPath);
    return;
  }
  for (const [prevOld, prevNew] of Array.from(map.entries())) {
    if (prevNew === oldPath) {
      map.set(prevOld, newPath);
      return;
    }
  }
  map.set(oldPath, newPath);
}

export class VaultWatcher {
  private app: App;
  private dirtyPaths = new Set<string>();
  private deletedPaths = new Set<string>();
  private renamedPaths = new Map<string, string>();
  private suppressQueue = new Map<string, number>();
  private eventRefs: EventRef[] = [];
  private started = false;
  private debounceTimer: number | null = null;
  private onDirtyCallback: (batch: VaultChangeBatch) => void;
  private debounceMs: number;

  constructor(
    app: App,
    onDirtyCallback: (batch: VaultChangeBatch) => void,
    debounceMs = 1500
  ) {
    this.app = app;
    this.onDirtyCallback = onDirtyCallback;
    this.debounceMs = debounceMs;
  }

  suppress(path: string, durationMs = 3000): void {
    const norm = normalizePath(path);
    this.suppressQueue.set(norm, Date.now() + durationMs);
  }

  isSuppressed(path: string): boolean {
    const norm = normalizePath(path);
    const expire = this.suppressQueue.get(norm);
    if (!expire) return false;
    if (Date.now() > expire) {
      this.suppressQueue.delete(norm);
      return false;
    }
    return true;
  }

  private shouldIgnore(path: string): boolean {
    const norm = normalizePath(path);
    if (norm.startsWith('.obsidian') || norm.startsWith('.trash') || norm.startsWith('.git')) {
      return true;
    }
    if (norm.endsWith('.DS_Store') || norm === '.DS_Store') {
      return true;
    }
    return false;
  }

  private recordChange(path: string): void {
    const norm = normalizePath(path);
    if (this.shouldIgnore(norm)) return;
    if (this.isSuppressed(norm)) return;

    this.dirtyPaths.add(norm);
    this.deletedPaths.delete(norm);
    this.scheduleDebounce();
  }

  private recordDelete(path: string): void {
    const norm = normalizePath(path);
    if (this.shouldIgnore(norm)) return;
    if (this.isSuppressed(norm)) return;

    this.deletedPaths.add(norm);
    this.dirtyPaths.delete(norm);
    this.scheduleDebounce();
  }

  private recordRename(oldPath: string, newPath: string): void {
    const oldNorm = normalizePath(oldPath);
    const newNorm = normalizePath(newPath);
    if (this.shouldIgnore(oldNorm) || this.shouldIgnore(newNorm)) return;
    if (this.isSuppressed(oldNorm) || this.isSuppressed(newNorm)) return;

    this.deletedPaths.delete(oldNorm);
    this.dirtyPaths.delete(newNorm);
    foldRename(this.renamedPaths, oldNorm, newNorm);
    this.scheduleDebounce();
  }

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      if (this.dirtyPaths.size > 0 || this.deletedPaths.size > 0 || this.renamedPaths.size > 0) {
        const batch: VaultChangeBatch = {
          dirty: new Set(this.dirtyPaths),
          deleted: new Set(this.deletedPaths),
          renamed: Array.from(this.renamedPaths, ([oldPath, newPath]) => ({ oldPath, newPath }))
        };
        this.dirtyPaths.clear();
        this.deletedPaths.clear();
        this.renamedPaths.clear();
        this.onDirtyCallback(batch);
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.eventRefs = [
      this.app.vault.on('modify', (file: TAbstractFile) => {
        this.recordChange(file.path);
      }),
      this.app.vault.on('create', (file: TAbstractFile) => {
        this.recordChange(file.path);
      }),
      this.app.vault.on('delete', (file: TAbstractFile) => {
        this.recordDelete(file.path);
      }),
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        this.recordRename(oldPath, file.path);
      })
    ];
  }

  stop(): void {
    for (const eventRef of this.eventRefs) {
      this.app.vault.offref(eventRef);
    }
    this.eventRefs = [];
    this.started = false;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirtyPaths.clear();
    this.deletedPaths.clear();
    this.renamedPaths.clear();
    this.suppressQueue.clear();
  }
}

import { normalizePath, type App, type TAbstractFile } from 'obsidian';

export class VaultWatcher {
  private app: App;
  private dirtyPaths = new Set<string>();
  private deletedPaths = new Set<string>();
  private suppressQueue = new Map<string, number>(); // path -> expire timestamp
  private debounceTimer: number | null = null;
  private onDirtyCallback: (dirty: Set<string>, deleted: Set<string>) => void;
  private debounceMs: number;

  constructor(
    app: App,
    onDirtyCallback: (dirty: Set<string>, deleted: Set<string>) => void,
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

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      if (this.dirtyPaths.size > 0 || this.deletedPaths.size > 0) {
        const dirtyBatch = new Set(this.dirtyPaths);
        const deletedBatch = new Set(this.deletedPaths);
        this.dirtyPaths.clear();
        this.deletedPaths.clear();
        this.onDirtyCallback(dirtyBatch, deletedBatch);
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  start(): void {
    this.app.vault.on('modify', (file: TAbstractFile) => {
      this.recordChange(file.path);
    });

    this.app.vault.on('create', (file: TAbstractFile) => {
      this.recordChange(file.path);
    });

    this.app.vault.on('delete', (file: TAbstractFile) => {
      this.recordDelete(file.path);
    });

    this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      this.recordDelete(oldPath);
      this.recordChange(file.path);
    });
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirtyPaths.clear();
    this.deletedPaths.clear();
    this.suppressQueue.clear();
  }
}

/**
 * Minimal structured logger (single-node server).
 *
 * - Human-readable lines by default: `2026-10-08T16:00:00.000Z [info] message key=value`
 * - `LOG_FORMAT=json` emits one JSON object per line for Loki/ELK/Promtail.
 * - `LOG_LEVEL=debug|info|warn|error` (default `info`) filters below-level lines.
 * - Tests redirect output with `setLogSink`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let levelOverride: LogLevel | null = null;
let formatOverride: 'text' | 'json' | null = null;
let sink: ((level: LogLevel, line: string) => void) | null = null;

function envLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

function envFormat(): 'text' | 'json' {
  return (process.env.LOG_FORMAT || 'text').toLowerCase() === 'json' ? 'json' : 'text';
}

/** Pure formatter: also used by tests. `error` values serialize to their message. */
export function formatLogLine(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  time = new Date().toISOString()
): string {
  const safeFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safeFields[key] = value instanceof Error ? value.message : value;
  }
  if ((formatOverride || envFormat()) === 'json') {
    return JSON.stringify({ time, level, msg: message, ...safeFields });
  }
  const flat = Object.entries(safeFields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
    .join(' ');
  return `${time} [${level}] ${message}${flat ? ` ${flat}` : ''}`;
}

/** Redirect log output (tests). Pass null to restore the console default. */
export function setLogSink(fn: ((level: LogLevel, line: string) => void) | null): void {
  sink = fn;
}

export function setLogLevel(level: LogLevel | null): void {
  levelOverride = level;
}

export function setLogFormat(format: 'text' | 'json' | null): void {
  formatOverride = format;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const threshold = levelOverride || envLevel();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  const line = formatLogLine(level, message, fields);
  if (sink) {
    sink(level, line);
    return;
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function withFields(fields: Record<string, unknown>) {
  return {
    debug: (message: string, extra: Record<string, unknown> = {}) => write('debug', message, { ...fields, ...extra }),
    info: (message: string, extra: Record<string, unknown> = {}) => write('info', message, { ...fields, ...extra }),
    warn: (message: string, extra: Record<string, unknown> = {}) => write('warn', message, { ...fields, ...extra }),
    error: (message: string, extra: Record<string, unknown> = {}) => write('error', message, { ...fields, ...extra })
  };
}

export const logger = {
  debug: (message: string, fields: Record<string, unknown> = {}) => write('debug', message, fields),
  info: (message: string, fields: Record<string, unknown> = {}) => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write('error', message, fields),
  withFields
};

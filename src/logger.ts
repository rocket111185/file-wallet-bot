/**
 * Structured logger for Workers Logs.
 *
 * Workers Logs (enabled via `observability` in wrangler.jsonc) indexes every field of a logged
 * object, so `{ event: 'db.addFolder.failed', userId: 42 }` can be filtered by `event` or `userId`
 * in the dashboard instead of grepping message strings.
 */

type LogFields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const serializeError = (err: unknown): LogFields =>
  err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) };

const write = (level: Level, event: string, fields: LogFields = {}): void => {
  const { err, ...rest } = fields;
  const entry: LogFields = { level, event, ...rest };
  if (err !== undefined) entry.error = serializeError(err);
  console[level](entry);
};

export const logger = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  /** Pass the caught value as `err` to get its name, message and stack logged as `error.*` */
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};

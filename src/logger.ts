import pino from 'pino';

/**
 * Application-wide structured logger using pino.
 *
 * - Output: JSON (newline-delimited)
 * - Level:  controlled by LOG_LEVEL env var (default: 'info')
 *
 * Usage:
 *   import { logger, createRequestLogger } from './logger.ts';
 *   logger.info({ component: 'server' }, 'Server started');
 *
 *   // In request handlers:
 *   const reqLog = createRequestLogger(requestId);
 *   reqLog.info({ path: '/api/search' }, 'Handling search');
 */

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  ...(process.env.NODE_ENV === 'test' ? { enabled: false } : {}),
});

/**
 * Create a child logger scoped to a specific request.
 * Propagates the requestId through all downstream log lines.
 */
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

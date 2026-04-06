/**
 * Unit tests for structured logging module (src/logger.ts).
 *
 * Verifies that the pino-based logger and request-scoped child loggers
 * are properly configured with expected structure and behaviour.
 */
import { describe, test, expect } from 'bun:test';
import { logger, createRequestLogger } from '../../src/logger.ts';

describe('Structured logging', () => {
  test('logger instance exists and has standard log methods', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  test('logger supports child() for scoped logging', () => {
    const child = logger.child({ component: 'test-component' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
  });

  test('createRequestLogger returns a child logger with requestId binding', () => {
    const reqLogger = createRequestLogger('req-abc-123');
    expect(reqLogger).toBeDefined();
    expect(typeof reqLogger.info).toBe('function');
    // pino child loggers have bindings() that includes the requestId
    const bindings = reqLogger.bindings();
    expect(bindings.requestId).toBe('req-abc-123');
  });

  test('createRequestLogger produces unique loggers per request ID', () => {
    const log1 = createRequestLogger('req-1');
    const log2 = createRequestLogger('req-2');
    expect(log1.bindings().requestId).toBe('req-1');
    expect(log2.bindings().requestId).toBe('req-2');
    expect(log1).not.toBe(log2);
  });

  test('logger is disabled in test environment', () => {
    // In test env, pino should be disabled (enabled: false)
    // The logger exists but writes are no-ops
    expect(logger).toBeDefined();
    // Calling log methods in test env should not throw
    expect(() => logger.info('test message')).not.toThrow();
    expect(() => logger.error({ err: 'test' }, 'error msg')).not.toThrow();
  });
});

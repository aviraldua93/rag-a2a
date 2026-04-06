/**
 * Counting semaphore for limiting concurrent access to a resource.
 *
 * @example
 * ```ts
 * const sem = new Semaphore(3);
 *
 * // Option A: acquire / release
 * const release = await sem.acquire();
 * try { await doWork(); } finally { release(); }
 *
 * // Option B: withLock helper
 * await sem.withLock(() => doWork());
 * ```
 */
export class Semaphore {
  private permits: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error('Semaphore maxConcurrency must be >= 1');
    }
    this.permits = maxConcurrency;
  }

  /** Current number of available permits. */
  get available(): number {
    return this.permits;
  }

  /** Number of callers waiting for a permit. */
  get waiting(): number {
    return this.waitQueue.length;
  }

  /**
   * Acquire a permit. Resolves immediately if one is available,
   * otherwise blocks until a permit is freed.
   *
   * @returns A release function — call it when you are done.
   */
  acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(this.createRelease());
    }

    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        resolve(this.createRelease());
      });
    });
  }

  /**
   * Convenience helper: acquire a permit, run `fn`, then release.
   * The permit is always released even if `fn` throws.
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // -- internal ---------------------------------------------------------

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent
      released = true;
      this.release();
    };
  }

  private release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      // Hand the permit directly to the next waiter (no increment).
      next();
    } else {
      this.permits++;
    }
  }
}

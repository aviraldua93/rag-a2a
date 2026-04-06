import { describe, test, expect } from 'bun:test';
import { Semaphore } from '../../src/concurrency/semaphore.ts';

describe('Semaphore', () => {
  test('constructor rejects maxConcurrency < 1', () => {
    expect(() => new Semaphore(0)).toThrow('maxConcurrency must be >= 1');
    expect(() => new Semaphore(-1)).toThrow('maxConcurrency must be >= 1');
  });

  test('available starts at maxConcurrency', () => {
    const sem = new Semaphore(5);
    expect(sem.available).toBe(5);
  });

  test('acquire decrements available permits', async () => {
    const sem = new Semaphore(3);
    await sem.acquire();
    expect(sem.available).toBe(2);
    await sem.acquire();
    expect(sem.available).toBe(1);
  });

  test('release increments available permits', async () => {
    const sem = new Semaphore(2);
    const release1 = await sem.acquire();
    const release2 = await sem.acquire();
    expect(sem.available).toBe(0);

    release1();
    expect(sem.available).toBe(1);
    release2();
    expect(sem.available).toBe(2);
  });

  test('double release is idempotent', async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release(); // should not throw or over-release
    expect(sem.available).toBe(1);
  });

  test('N+1 acquires with N-capacity blocks the last caller until release', async () => {
    const sem = new Semaphore(2);
    const order: string[] = [];

    const release1 = await sem.acquire();
    order.push('acquired-1');

    const release2 = await sem.acquire();
    order.push('acquired-2');

    // Third acquire should block
    let thirdResolved = false;
    const thirdPromise = sem.acquire().then((release) => {
      thirdResolved = true;
      order.push('acquired-3');
      return release;
    });

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10));
    expect(thirdResolved).toBe(false);
    expect(sem.waiting).toBe(1);

    // Release one permit — the third should now resolve
    release1();
    const release3 = await thirdPromise;
    expect(thirdResolved).toBe(true);
    expect(order).toEqual(['acquired-1', 'acquired-2', 'acquired-3']);

    release2();
    release3();
  });

  test('waiters are resolved in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const release1 = await sem.acquire();

    // Queue up 3 waiters
    const p2 = sem.acquire().then((r) => { order.push(2); return r; });
    const p3 = sem.acquire().then((r) => { order.push(3); return r; });
    const p4 = sem.acquire().then((r) => { order.push(4); return r; });

    expect(sem.waiting).toBe(3);

    // Release sequentially
    release1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();
    const r4 = await p4;
    r4();

    expect(order).toEqual([2, 3, 4]);
  });

  test('withLock runs function and releases on success', async () => {
    const sem = new Semaphore(1);
    const result = await sem.withLock(async () => {
      expect(sem.available).toBe(0);
      return 42;
    });
    expect(result).toBe(42);
    expect(sem.available).toBe(1);
  });

  test('withLock releases permit even on error', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.available).toBe(1);
  });

  test('withLock limits concurrency', async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async (id: number) => {
      return sem.withLock(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return id;
      });
    };

    // Launch 5 tasks concurrently
    const results = await Promise.all([
      task(1),
      task(2),
      task(3),
      task(4),
      task(5),
    ]);

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBe(2);
    expect(sem.available).toBe(2);
  });

  test('semaphore with concurrency 1 serializes execution', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const task = (id: number) =>
      sem.withLock(async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, 10));
      });

    await Promise.all([task(1), task(2), task(3)]);
    // With concurrency 1, tasks run serially
    expect(order).toEqual([1, 2, 3]);
  });
});

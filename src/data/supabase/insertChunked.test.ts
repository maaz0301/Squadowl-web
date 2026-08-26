import { describe, expect, it } from 'vitest';
import { insertChunked, isStatementTimeout } from './SupabaseDataSource';

/**
 * `insertChunked` is what keeps the dummy-data batches inside Postgres's 8s
 * statement timeout. Its behaviour under a server that rejects oversized
 * statements is not observable from the UI until a 1000-player run has already
 * half-written itself, so it is pinned here instead.
 */

function timeoutError(): Error & { code?: string } {
  const e = new Error('canceling statement due to statement timeout') as Error & { code?: string };
  e.code = '57014';
  return e;
}

/**
 * A fake PostgREST that 57014s any statement carrying more than `limit` rows,
 * and records what it was actually asked to write.
 */
function fakeServer(limit: number) {
  const written: number[] = [];
  let requests = 0;
  let timeouts = 0;
  const task = async (chunk: number[], offset: number) => {
    requests++;
    if (chunk.length > limit) {
      timeouts++;
      // A statement killed by the timeout is rolled back whole — nothing from
      // this chunk is recorded, which is what makes the retry safe.
      throw timeoutError();
    }
    expect(chunk[0]).toBe(offset);
    written.push(...chunk);
    return chunk.map((n) => `id-${n}`);
  };
  return { task, written, stats: () => ({ requests, timeouts }) };
}

const items = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('isStatementTimeout', () => {
  it('recognizes the SQLSTATE and the bare message', () => {
    expect(isStatementTimeout(timeoutError())).toBe(true);
    expect(isStatementTimeout(new Error('canceling statement due to statement timeout'))).toBe(true);
  });

  it('does not swallow other failures', () => {
    const rls = new Error('new row violates row-level security policy') as Error & { code?: string };
    rls.code = '42501';
    expect(isStatementTimeout(rls)).toBe(false);
    expect(isStatementTimeout(undefined)).toBe(false);
  });
});

describe('insertChunked', () => {
  it('sends every row once, in order, when nothing times out', async () => {
    const server = fakeServer(1000);
    const out = await insertChunked(items(1000), 100, server.task);

    expect(out).toEqual(items(1000).map((n) => `id-${n}`));
    expect(server.written).toEqual(items(1000));
    expect(server.stats()).toEqual({ requests: 10, timeouts: 0 });
  });

  it('shrinks and retries past a statement timeout without dropping or duplicating rows', async () => {
    const server = fakeServer(40);
    const out = await insertChunked(items(5000), 250, server.task);

    expect(out).toEqual(items(5000).map((n) => `id-${n}`));
    // The regression this pins: a chunk being re-sent while a concurrent worker
    // shrinks the shared size used to overlap, writing some rows twice.
    expect(server.written.slice().sort((a, b) => a - b)).toEqual(items(5000));
    expect(server.stats().timeouts).toBeGreaterThan(0);
  });

  it('reports monotonic progress totalling the input', async () => {
    const server = fakeServer(60);
    const seen: number[] = [];
    await insertChunked(items(1000), 100, server.task, (done) => seen.push(done));

    expect(seen.at(-1)).toBe(1000);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('surfaces a timeout that survives shrinking to the floor, rather than retrying forever', async () => {
    // No chunk size this helper is willing to send can satisfy a 5-row ceiling.
    const server = fakeServer(5);
    await expect(insertChunked(items(1000), 100, server.task)).rejects.toThrow(
      /canceling statement due to statement timeout/,
    );
  });

  it('does not retry a failure that is not a timeout', async () => {
    let requests = 0;
    await expect(
      insertChunked(items(200), 100, async () => {
        requests++;
        throw new Error('new row violates row-level security policy');
      }),
    ).rejects.toThrow(/row-level security/);
    expect(requests).toBe(2);
  });

  it('handles an empty batch', async () => {
    const server = fakeServer(10);
    expect(await insertChunked([], 100, server.task)).toEqual([]);
    expect(server.stats().requests).toBe(0);
  });
});

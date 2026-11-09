// Cross-process advisory lock based on exclusive file creation.
//
// Protocol (part of the contract notes): a writer creates `<file>.lock` with
// O_CREAT | O_EXCL, does its read-modify-append, then deletes the lock file.
// A lock older than `staleMs` is considered abandoned and removed.

import { closeSync, openSync, rmSync, statSync, writeSync } from "node:fs";

const sleeper = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}

export class LockTimeoutError extends Error {
  constructor(lockPath, timeoutMs) {
    super(`Timed out after ${timeoutMs} ms waiting for lock ${lockPath}`);
    this.name = "LockTimeoutError";
  }
}

/**
 * Run `fn` while holding the lock for `target` (`<target>.lock`).
 * @template T
 * @param {string} target file the lock protects
 * @param {() => T} fn
 * @returns {T}
 */
export function withLock(
  target,
  fn,
  { timeoutMs = 15000, staleMs = 30000 } = {}
) {
  const lockPath = `${target}.lock`;
  const deadline = Date.now() + timeoutMs;
  let fd;
  let delay = 2;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (err) {
      if (err.code !== "EEXIST" && err.code !== "EPERM") throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // The lock disappeared between open and stat: retry immediately.
        continue;
      }
      if (Date.now() > deadline) throw new LockTimeoutError(lockPath, timeoutMs);
      sleep(delay + Math.floor(Math.random() * delay));
      delay = Math.min(delay * 2, 50);
    }
  }
  try {
    writeSync(fd, String(process.pid));
    closeSync(fd);
    fd = undefined;
    return fn();
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

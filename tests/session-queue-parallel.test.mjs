import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("不同会话使用独立队列并行执行", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "signal-desk-queues-"));
  const previous = process.env.SESSIONS_DIR;
  process.env.SESSIONS_DIR = dir;
  try {
    const store = await import(`../src/sessionStore.js?queue=${Date.now()}`);
    const [a, b] = await Promise.all([store.createSession(), store.createSession()]);
    let active = 0;
    let maxActive = 0;
    const task = (id) => store.withSessionLock(id, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    });
    await Promise.all([task(a.id), task(b.id)]);
    assert.equal(maxActive, 2);
  } finally {
    if (previous === undefined) delete process.env.SESSIONS_DIR;
    else process.env.SESSIONS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

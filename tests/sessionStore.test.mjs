import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(
  path.join(os.tmpdir(), "signal-desk-sessions-"),
);
process.env.SESSIONS_DIR = directory;
const store = await import("../src/sessionStore.js");

test.after(async () => rm(directory, { recursive: true, force: true }));

test("会话持久化、索引和消息 sessionId 一致", async () => {
  const session = await store.createSession("", "首条用户问题");
  const result = await store.appendMessages(session.id, [
    {
      role: "user",
      content: "首条用户问题",
      request: { request: "首条用户问题" },
    },
  ]);
  assert.equal(result.session.title, "首条用户问题");
  assert.equal(result.messages[0].sessionId, session.id);
  const loaded = await store.getSession(session.id);
  assert.equal(loaded.messages[0].sessionId, loaded.id);
  assert.equal((await store.listSessions())[0].messageCount, 1);
});

test("同一会话并发追加不会丢消息", async () => {
  const session = await store.createSession("并发测试");
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      store.appendMessages(session.id, [
        { role: "user", content: `消息 ${index}` },
      ]),
    ),
  );
  const loaded = await store.getSession(session.id);
  assert.equal(loaded.messages.length, 8);
  assert.equal(new Set(loaded.messages.map((message) => message.id)).size, 8);
});

test("上下文最多保留六轮且大 schema 降级摘要", async () => {
  const session = await store.createSession("上下文测试");
  const messages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `消息 ${index}`,
    schema:
      index % 2
        ? {
            stockId: "A",
            timeRange: { value: 30 },
            metrics: ["price"],
            padding: "x".repeat(1400),
          }
        : null,
  }));
  await store.appendMessages(session.id, messages);
  const context = store.recentContext(await store.getSession(session.id));
  assert.equal(context.length, 12);
  const assistant = context.find((message) => message.role === "assistant");
  assert.deepEqual(assistant.schema, {
    stockId: "A",
    days: 30,
    metrics: ["price"],
  });
});

test("非法 ID 不进入文件系统", async () => {
  await assert.rejects(() => store.getSession("../../package.json"), {
    status: 400,
  });
  await assert.rejects(
    () => readFile(path.join(directory, "..", "package.json")),
    /./,
  );
});

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const root = path.resolve(process.env.SESSIONS_DIR || "data/sessions");
const queues = new Map();

function assertId(id) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    const error = new Error("会话 ID 必须是有效的 UUID。");
    error.status = 400;
    throw error;
  }
}

function filePath(id) {
  assertId(id);
  return path.join(root, `${id}.json`);
}

async function atomicWrite(file, value) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

async function ensureRoot() {
  await fs.mkdir(root, { recursive: true });
}

function enqueue(id, task) {
  const previous = queues.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  queues.set(
    id,
    current.finally(() => {
      if (queues.get(id) === current) queues.delete(id);
    }),
  );
  return current;
}

export function withSessionLock(id, task) {
  assertId(id);
  return enqueue(id, task);
}

function validateSession(session) {
  assertId(session?.id);
  if (typeof session.title !== "string" || !session.title.trim())
    throw new Error("会话标题不能为空。");
  if (!Array.isArray(session.messages)) throw new Error("会话消息必须是数组。");
  for (const message of session.messages) {
    assertId(message.id);
    if (message.sessionId !== session.id)
      throw new Error("消息 sessionId 与会话不一致。");
    if (!["user", "assistant"].includes(message.role))
      throw new Error("消息角色不受支持。");
    if (typeof message.content !== "string")
      throw new Error("消息内容必须是字符串。");
  }
  return session;
}

function titleFrom(title, content) {
  const value =
    typeof title === "string" && title.trim() ? title.trim() : content.trim();
  return value.slice(0, 80) || "新建分析";
}

export async function createSession(title = "", firstContent = "") {
  await ensureRoot();
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    title: titleFrom(title, firstContent),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await atomicWrite(filePath(session.id), session);
  return session;
}

export async function getSession(id) {
  const file = filePath(id);
  try {
    return validateSession(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      error.status = 404;
      error.message = "会话不存在。";
    } else if (!error.status) {
      error.status = 409;
    }
    throw error;
  }
}

export async function listSessions() {
  await ensureRoot();
  const names = await fs.readdir(root);
  const sessions = await Promise.all(
    names
      .filter((name) => UUID_RE.test(name.slice(0, -5)) && name.endsWith(".json"))
      .map(async (name) => {
        const session = await getSession(name.slice(0, -5));
        return {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
        };
      }),
  );
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function appendMessagesNow(id, session, messages) {
    const now = new Date().toISOString();
    const next = messages.map((message) => ({
      ...message,
      id: randomUUID(),
      sessionId: id,
      createdAt: message.createdAt || now,
    }));
    if (
      session.messages.length === 0 &&
      next[0]?.role === "user" &&
      session.title === "新建分析"
    )
      session.title = titleFrom("", next[0].content);
    session.messages.push(...next);
    session.updatedAt = now;
    await atomicWrite(filePath(id), validateSession(session));
  return { session, messages: next };
}

export async function appendMessages(id, messages) {
  return enqueue(id, async () => {
    const session = await getSession(id);
    return appendMessagesNow(id, session, messages);
  });
}

export { appendMessagesNow };

export async function updateSessionTitle(id, title) {
  if (typeof title !== "string" || !title.trim()) {
    const error = new Error("标题不能为空。");
    error.status = 400;
    throw error;
  }
  return enqueue(id, async () => {
    const session = await getSession(id);
    session.title = title.trim().slice(0, 80);
    session.updatedAt = new Date().toISOString();
    await atomicWrite(filePath(id), validateSession(session));
    return session;
  });
}

export async function deleteSession(id) {
  return enqueue(id, async () => {
    try {
      await fs.unlink(filePath(id));
    } catch (error) {
      if (error.code === "ENOENT") {
        error.status = 404;
        error.message = "会话不存在。";
      }
      throw error;
    }
  });
}

export function recentContext(session) {
  validateSession(session);
  const messages = session.messages.slice(-12);
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.schema) return message;
    const serialized = JSON.stringify(message.schema);
    const schema =
      serialized.length <= 1200
        ? message.schema
        : {
            stockId: message.schema.stockId,
            days: message.schema.timeRange?.value,
            metrics: message.schema.metrics,
          };
    return { ...message, schema };
  });
}

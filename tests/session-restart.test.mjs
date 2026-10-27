import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(".");

function runWorker(source, sessionsDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: root,
      env: { ...process.env, SESSIONS_DIR: sessionsDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0)
        reject(new Error(`worker failed (${code ?? signal}): ${stderr}`));
      else resolve(stdout.trim());
    });
  });
}

test("会话进程退出后从 JSON 文件恢复历史", async () => {
  const sessionsDir = await mkdtemp(path.join(os.tmpdir(), "signal-desk-restart-"));
  try {
    const created = await runWorker(
      `import { createSession, appendMessages } from './src/sessionStore.js';
       const s = await createSession('重启验收', '');
       await appendMessages(s.id, [{ role: 'user', content: '重启后仍可见', schema: null }]);
       console.log(s.id);`,
      sessionsDir,
    );
    const restored = await runWorker(
      `import { getSession } from './src/sessionStore.js';
       const s = await getSession(${JSON.stringify(created)});
       console.log(JSON.stringify({ id: s.id, count: s.messages.length, content: s.messages[0].content }));`,
      sessionsDir,
    );
    assert.deepEqual(JSON.parse(restored), {
      id: created,
      count: 1,
      content: "重启后仍可见",
    });
  } finally {
    await rm(sessionsDir, { recursive: true, force: true });
  }
});

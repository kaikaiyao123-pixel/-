import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromptMessages,
  MAX_HISTORY_MESSAGES,
  MAX_SCHEMA_CONTEXT_CHARS,
} from "../src/promptContext.js";

test("prompt 只保留最近六轮并输出可复核 token 估算", () => {
  const hugeSchema = { stockId: "A", timeRange: { value: 30 }, metrics: ["price"], noise: "x".repeat(3000) };
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `message-${index}`,
    schema: index % 2 ? hugeSchema : null,
  }));
  const result = buildPromptMessages({
    systemContext: "system",
    request: "当前请求",
    previousSchema: hugeSchema,
    history,
  });
  console.log(`[context-test] history_messages=${result.historyMessageCount} prompt_token_estimate=${result.promptTokenEstimate} serialized_chars=${JSON.stringify(result.messages).length}`);
  assert.equal(result.historyMessageCount, MAX_HISTORY_MESSAGES);
  assert.equal(result.promptTokenEstimate, Math.ceil(JSON.stringify(result.messages).length / 4));
  const content = result.messages[1].content;
  assert.match(content, /message-19/);
  assert.doesNotMatch(content, /x{1201}/);
  assert.ok(content.includes('"stockId":"A"'));
  assert.ok(content.includes('"days":30'));
  assert.ok(content.includes('"metrics":["price"]'));
  assert.ok(JSON.stringify(result.messages).length < MAX_SCHEMA_CONTEXT_CHARS);
});

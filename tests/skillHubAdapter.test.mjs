import test from "node:test";
import assert from "node:assert/strict";
import { fetchSkillHub, mockSkillHub } from "../src/skillHub.js";

const intent = { stockId: "A", days: 10, metrics: ["price", "volume"] };

test("mock Skill Hub is deterministic and normalizes rows", async () => {
  const one = await fetchSkillHub(intent, { WENCAI_SKILL_HUB_MOCK: "success" });
  const two = await fetchSkillHub(intent, { WENCAI_SKILL_HUB_MOCK: "success" });
  assert.deepEqual(one, two);
  assert.equal(one.rows.length, 10);
  assert.ok(Number.isFinite(one.rows[0].price));
});

test("mock failure modes produce structured fallback errors", async () => {
  await assert.rejects(() => fetchSkillHub(intent, { WENCAI_SKILL_HUB_MOCK: "fail" }), /禁用/);
  await assert.rejects(() => fetchSkillHub(intent, { WENCAI_SKILL_HUB_MOCK: "empty" }), /空数据/);
  await assert.rejects(() => fetchSkillHub(intent, { WENCAI_SKILL_HUB_MOCK: "invalid" }), /无法识别/);
});

test("mock helper supports supported companies", () => {
  for (const stockId of ["A", "B", "C"]) assert.equal(mockSkillHub({ stockId, days: 10 }).rows.length, 10);
});

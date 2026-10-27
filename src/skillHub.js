import { normalizeRows, getStockData } from "./analysisEngine.js";

export class SkillHubError extends Error {
  constructor(message, code = "provider_error") {
    super(message);
    this.name = "SkillHubError";
    this.code = code;
  }
}

export function mockSkillHub(intent, mode = "success") {
  if (mode === "fail") throw new SkillHubError("本地 Mock Skill Hub 已禁用。", "unavailable");
  if (mode === "empty") return { rows: [], dataAsOf: null };
  if (mode === "invalid") return { rows: [{ date: "bad" }], dataAsOf: null };
  const rows = getStockData(intent.stockId, intent.timeRange?.value || intent.days || 30);
  return { rows, dataAsOf: rows.at(-1)?.date || null };
}

export async function fetchSkillHub(intent, env = process.env) {
  if (env.WENCAI_SKILL_HUB_MOCK) {
    const result = mockSkillHub(intent, env.WENCAI_SKILL_HUB_MOCK);
    if (!result.rows.length) throw new SkillHubError("数据源返回了空数据。", "empty");
    return { ...result, rows: normalizeRows(result.rows) };
  }
  const endpoint = env.WENCAI_SKILL_HUB_URL;
  if (!endpoint) throw new SkillHubError("问财 Skill Hub 未配置服务地址。", "unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.WENCAI_SKILL_HUB_TIMEOUT_MS || 5000));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.WENCAI_SKILL_HUB_TOKEN ? { authorization: `Bearer ${env.WENCAI_SKILL_HUB_TOKEN}` } : {}) },
      body: JSON.stringify({ stockId: intent.stockId, days: intent.timeRange?.value || intent.days, metrics: intent.metrics }),
      signal: controller.signal,
    });
    if (!response.ok) throw new SkillHubError(`问财 Skill Hub 返回 HTTP ${response.status}。`, "http_error");
    let payload;
    try { payload = await response.json(); } catch { throw new SkillHubError("问财 Skill Hub 返回了无效 JSON。", "invalid_json"); }
    const rows = normalizeRows(payload.rows || payload.data || payload);
    return { rows, dataAsOf: payload.dataAsOf || payload.data_as_of || rows.at(-1)?.date };
  } catch (error) {
    if (error.name === "AbortError") throw new SkillHubError("问财 Skill Hub 请求超时。", "timeout");
    if (error instanceof SkillHubError) throw error;
    throw new SkillHubError(error.message || "问财 Skill Hub 请求失败。", "provider_error");
  } finally { clearTimeout(timeout); }
}

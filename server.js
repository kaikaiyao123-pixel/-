import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import {
  applyFollowup,
  buildDashboard,
  createSchema,
  DATA_SOURCES,
  normalizeRows,
  parseRequest,
  SAMPLE_DATA,
  LOCAL_DATA_AS_OF,
  validateSchema,
} from "./src/analysisEngine.js";
import {
  appendMessages,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  recentContext,
  withSessionLock,
  appendMessagesNow,
  updateSessionTitle,
} from "./src/sessionStore.js";
import { fetchSkillHub } from "./src/skillHub.js";
import { buildPromptMessages } from "./src/promptContext.js";

const stages = [
  "understanding",
  "schema",
  "validation",
  "data",
  "analysis",
  "complete",
];
const systemContext = `你是 Signal Desk 股票分析 Agent。你只负责把用户的自然语言请求转换为严格 JSON，不提供投资建议，不编造行情。\n\n产品上下文：这是离线演示应用，只能分析固定模拟数据中的股票：A=东方财富（300059.SZ）、B=贵州茅台（600519.SH）、C=宁德时代（300750.SZ）。用户可以使用公司名称、股票代码或 A/B/C 标识；请将结果中的 stockId 统一返回为 A、B 或 C。只支持最近 10、15、20、30 个交易日；指标只支持 price（收盘价）、volume（成交量）、change（涨跌幅）。用户请求不符合这些范围时，返回 JSON 字段 error，说明可修正输入。\n\n请严格只返回 JSON，成功格式：{"stockId":"A","days":30,"metrics":["price","volume"],"title":"东方财富（300059.SZ）最近 30 天股价与成交量"}。metrics 至少包含 price，最多再包含 volume 或 change 一个；不要输出 Markdown。`;
const sourceOptions = new Set(Object.values(DATA_SOURCES));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function unavailableResult(schema, stages, mode = "local-rules", model = null) {
  const notice = "暂未找到该公司的行情接口或 API Key，已生成结构化 Schema，但暂不生成图表。";
  return {
    schema,
    dashboard: {
      validation: { valid: false, errors: [notice] },
      rows: [],
      worst: [],
      insight: null,
    },
    stages,
    mode,
    model,
    unavailable: true,
    notice,
  };
}

async function resolveData(intent, requestedSource) {
  if (requestedSource !== DATA_SOURCES.skillHub)
    return {
      rows: null,
      resolvedSource: DATA_SOURCES.local,
      fallbackReason: null,
    };
  try {
    const result = await fetchSkillHub(intent, {
      ...process.env,
      // Keep the offline demo reproducible when no external provider is configured.
      WENCAI_SKILL_HUB_MOCK:
        process.env.WENCAI_SKILL_HUB_MOCK ||
        (process.env.WENCAI_SKILL_HUB_URL ? "" : "success"),
    });
    return {
      ...result,
      resolvedSource: DATA_SOURCES.skillHub,
      fallbackReason: null,
    };
  } catch (error) {
    return {
      rows: null,
      resolvedSource: DATA_SOURCES.local,
      fallbackReason: `问财 Skill Hub 不可用，已回退到本地模拟数据：${error.message}`,
    };
  }
}

async function analyze(req, res, payloadOverride = null) {
  let payload = payloadOverride;
  if (!payload) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      payload = JSON.parse(body);
    } catch {
      return json(res, 400, { error: "请求内容必须是 JSON。" });
    }
  }
  const request =
    typeof payload.request === "string" ? payload.request.trim() : "";
  const previousSchema =
    payload.previousSchema && typeof payload.previousSchema === "object"
      ? payload.previousSchema
      : null;
  const requestedSource =
    payload.source || previousSchema?.requestedSource || DATA_SOURCES.local;
  if (!request) return json(res, 400, { error: "请输入股票分析请求。" });
  if (!sourceOptions.has(requestedSource))
    return json(res, 422, {
      error: "数据源不受支持，请选择本地模拟数据或问财 Skill Hub。",
      stages,
    });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const followup = previousSchema
      ? applyFollowup(request, previousSchema)
      : null;
    if (followup?.error)
      return json(res, 422, {
        error: followup.error,
        stages,
        mode: "local-rules",
      });
    const schema = followup?.schema || parseRequest(request, previousSchema);
    schema.requestedSource = requestedSource;
    schema.resolvedSource = requestedSource;
    schema.dataSource =
      requestedSource === DATA_SOURCES.skillHub
        ? "问财 Skill Hub"
        : "本地固定模拟数据";
    schema.fallbackReason = null;
    const validation = validateSchema(schema, { allowExternalStock: true });
    if (!validation.valid)
      return json(res, 422, {
        error: validation.errors.join(" "),
        stages,
        mode: "local-rules",
      });
    if (!SAMPLE_DATA[schema.stockId] && !process.env.WENCAI_SKILL_HUB_URL)
      return json(res, 200, unavailableResult(schema, stages));
    const lookupSource = !SAMPLE_DATA[schema.stockId] ? DATA_SOURCES.skillHub : requestedSource;
    const resolved = await resolveData(schema, lookupSource);
    schema.resolvedSource = resolved.resolvedSource;
    schema.dataSource =
      resolved.resolvedSource === DATA_SOURCES.skillHub
        ? "问财 Skill Hub"
        : "本地固定模拟数据";
    schema.fallbackReason = resolved.fallbackReason;
    schema.dataAsOf = resolved.dataAsOf || (resolved.resolvedSource === DATA_SOURCES.local ? LOCAL_DATA_AS_OF : schema.dataAsOf);
    const resolvedValidation = validateSchema(schema, { allowExternalStock: resolved.resolvedSource === DATA_SOURCES.skillHub });
    if (!resolvedValidation.valid && !SAMPLE_DATA[schema.stockId])
      return json(res, 200, unavailableResult(schema, stages));
    if (!resolvedValidation.valid)
      return json(res, 422, { error: resolvedValidation.errors.join(" "), stages, mode: "local-rules" });
    return json(res, 200, {
      schema,
      dashboard: buildDashboard(schema, resolved.rows),
      stages,
      mode: "local-rules",
      model: null,
    });
  }

  const endpoint = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const prompt = buildPromptMessages({
      systemContext,
      request,
      previousSchema,
      history: payload.history,
    });
    console.info(
      `[context] session history messages=${prompt.historyMessageCount} turns=${Math.ceil(prompt.historyMessageCount / 2)} prompt_token_estimate=${prompt.promptTokenEstimate}`,
    );
    const completion = await fetch(
      `${endpoint.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: prompt.messages,
        }),
      },
    );
    const responseText = await completion.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      const preview = responseText.trim().startsWith("<")
        ? "服务商返回了 HTML 页面。"
        : responseText.slice(0, 180) || "服务商返回空响应。";
      return json(res, 502, {
        error: `模型服务响应格式无效（HTTP ${completion.status}）：${preview}`,
      });
    }
    if (!completion.ok)
      return json(res, 502, {
        error:
          result.error?.message || `模型服务返回 HTTP ${completion.status}。`,
      });
    const answer = JSON.parse(result.choices?.[0]?.message?.content || "{}");
    if (answer.error) return json(res, 422, { error: answer.error, stages });
    const schema = createSchema({ ...answer, requestedSource });
    const validation = validateSchema(schema, { allowExternalStock: true });
    if (!validation.valid)
      return json(res, 422, { error: validation.errors.join(" "), stages });
    if (!SAMPLE_DATA[schema.stockId] && !process.env.WENCAI_SKILL_HUB_URL)
      return json(res, 200, unavailableResult(schema, stages, "model", model));
    const lookupSource = !SAMPLE_DATA[schema.stockId] ? DATA_SOURCES.skillHub : requestedSource;
    const resolved = await resolveData(schema, lookupSource);
    schema.resolvedSource = resolved.resolvedSource;
    schema.dataSource =
      resolved.resolvedSource === DATA_SOURCES.skillHub
        ? "问财 Skill Hub"
        : "本地固定模拟数据";
    schema.fallbackReason = resolved.fallbackReason;
    schema.dataAsOf = resolved.dataAsOf || (resolved.resolvedSource === DATA_SOURCES.local ? LOCAL_DATA_AS_OF : schema.dataAsOf);
    const resolvedValidation = validateSchema(schema, { allowExternalStock: resolved.resolvedSource === DATA_SOURCES.skillHub });
    if (!resolvedValidation.valid && !SAMPLE_DATA[schema.stockId])
      return json(res, 200, unavailableResult(schema, stages, "model", model));
    if (!resolvedValidation.valid)
      return json(res, 422, { error: resolvedValidation.errors.join(" "), stages });
    const dashboard = buildDashboard(schema, resolved.rows);
    return json(res, 200, { schema, dashboard, stages, model });
  } catch (error) {
    return json(res, 502, { error: `Agent 调用失败：${error.message}` });
  }
}

async function analyzePayload(payload) {
  let status = 200;
  let body;
  const response = {
    writeHead(code) {
      status = code;
    },
    end(value) {
      body = value ? JSON.parse(value) : null;
    },
  };
  await analyze(null, response, payload);
  return { status, body };
}

async function sessionMessage(id, payload) {
  return withSessionLock(id, async () => {
    const session = await getSession(id);
    const request =
      typeof payload.request === "string" ? payload.request.trim() : "";
    if (!request) {
      const error = new Error("请输入股票分析请求。");
      error.status = 400;
      throw error;
    }
    if (payload.sessionId)
      console.warn("Ignoring body sessionId for session message route");
    if (payload.previousSchema)
      console.warn("Ignoring body previousSchema for session message route");
    const previousSchema =
      session.messages.filter((message) => message.role === "assistant").at(-1)
        ?.schema || null;
    const source =
      payload.source || previousSchema?.requestedSource || DATA_SOURCES.local;
    const userResult = await appendMessagesNow(id, session, [
      {
        role: "user",
        content: request,
        request: { request, source },
        schema: null,
        dashboard: null,
        stages: null,
        mode: null,
      },
    ]);
    const result = await analyzePayload({
      request,
      source,
      previousSchema,
      history: recentContext(userResult.session),
    });
    if (result.status >= 400) {
      const error = new Error(result.body?.error || "分析失败。");
      error.status = result.status;
      throw error;
    }
    const messageResult = await appendMessagesNow(id, userResult.session, [
      {
        role: "assistant",
        content: result.body.dashboard?.insight || "分析完成。",
        request: null,
        schema: result.body.schema,
        dashboard: result.body.dashboard,
        stages: result.body.stages,
        mode: result.body.mode,
      },
    ]);
    return {
      ...result.body,
      sessionId: id,
      message: messageResult.messages.at(-1),
    };
  });
}

function sessionRoute(pathname) {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)(\/messages)?$/);
  return match ? { id: match[1], messages: Boolean(match[2]) } : null;
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const server = createHttpServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.method === "POST" && pathname === "/api/sessions")
    return void (async () => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = body ? JSON.parse(body) : {};
        const session = await createSession(payload.title, "");
        return json(res, 201, {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
        });
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
    })();
  if (req.method === "GET" && pathname === "/api/sessions")
    return void listSessions()
      .then((sessions) => json(res, 200, sessions))
      .catch((error) => json(res, 500, { error: error.message }));
  const session = sessionRoute(pathname);
  if (session?.messages && req.method === "POST")
    return void (async () => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        return json(
          res,
          200,
          await sessionMessage(session.id, JSON.parse(body || "{}")),
        );
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    })();
  if (session && req.method === "GET")
    return void getSession(session.id)
      .then((value) =>
        json(res, 200, { session: value, messages: value.messages }),
      )
      .catch((error) =>
        json(res, error.status || 500, { error: error.message }),
      );
  if (session && req.method === "PATCH")
    return void (async () => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const value = await updateSessionTitle(
          session.id,
          JSON.parse(body || "{}").title,
        );
        return json(res, 200, { id: value.id, title: value.title });
      } catch (error) {
        return json(res, error.status || 500, { error: error.message });
      }
    })();
  if (session && req.method === "DELETE")
    return void deleteSession(session.id)
      .then(() => json(res, 204, null))
      .catch((error) =>
        json(res, error.status || 500, { error: error.message }),
      );
  if (req.method === "POST" && pathname === "/api/analyze")
    return void (async () => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        if (payload.sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.sessionId)) {
          return json(res, 400, { error: "会话 ID 必须是有效的 UUID。" });
        }
        const current = payload.sessionId
          ? await getSession(payload.sessionId)
          : await createSession("", payload.request || "");
        const result = await sessionMessage(current.id, payload);
        const {
          schema,
          dashboard,
          stages: resultStages,
          mode,
          model,
          unavailable,
          notice,
        } = result;
        return json(res, 200, {
          schema,
          dashboard,
          stages: resultStages,
          mode,
          model,
          ...(unavailable ? { unavailable: true, notice } : {}),
        });
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
    })();
  if (req.method === "GET" && req.url === "/api/status")
    return json(res, 200, {
      modelConfigured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  if (pathname.startsWith("/api/sessions"))
    return json(res, 404, { error: "会话路由不存在。" });
  vite.middlewares(req, res);
});
server.listen(Number(process.env.PORT || 5173), "127.0.0.1", () =>
  console.log(
    `Signal Desk ready at http://127.0.0.1:${process.env.PORT || 5173}`,
  ),
);

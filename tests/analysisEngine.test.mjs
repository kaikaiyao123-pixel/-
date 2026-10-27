import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFollowup,
  buildDashboard,
  createSchema,
  normalizeRows,
  normalizeStockId,
  parseRequest,
  validateSchema,
  DATA_SOURCES,
} from "../src/analysisEngine.js";
test("生成确定性看板", () => {
  const s = parseRequest("分析 A 公司最近 30 天的股价和成交量。");
  assert.equal(validateSchema(s).valid, true);
  assert.equal(buildDashboard(s).rows.length, 30);
});
test("非法输入返回错误", () => {
  const r = buildDashboard(parseRequest("分析 X 公司最近 11 天的市盈率"));
  assert.equal(r.validation.valid, false);
  assert.ok(r.validation.errors.length);
});
test("跟进修改保留未修改字段", () => {
  const s = parseRequest("分析 B 公司最近 30 天的成交量");
  const r = applyFollowup("把成交量改成涨跌幅", s).schema;
  assert.equal(r.stockId, "B");
  assert.equal(r.timeRange.value, 30);
  assert.deepEqual(r.metrics, ["price", "change"]);
});
test("后端将模型意图补全为可校验 Schema", () => {
  const schema = createSchema({
    stockId: "C",
    days: 15,
    metrics: ["price", "change"],
  });
  assert.equal(validateSchema(schema).valid, true);
  assert.equal(buildDashboard(schema).rows.length, 15);
});
test("无模型时的本地解析支持追问", () => {
  const first = parseRequest("分析 A 公司最近 30 天的股价和成交量。");
  const next = applyFollowup("把成交量改成涨跌幅", first).schema;
  assert.deepEqual(next.metrics, ["price", "change"]);
  assert.equal(next.stockId, "A");
});

test("公司名称和股票代码归一化到兼容的 A/B/C 标识", () => {
  assert.equal(normalizeStockId("东方财富"), "A");
  assert.equal(normalizeStockId("300059.SZ"), "A");
  assert.equal(normalizeStockId("600519"), "B");
  assert.equal(parseRequest("分析宁德时代最近 20 天的股价走势").stockId, "C");
  const schema = parseRequest("分析贵州茅台（600519.SH）最近 10 天的涨跌幅");
  assert.equal(schema.stockName, "贵州茅台");
  assert.equal(schema.stockCode, "600519.SH");
  assert.match(schema.title, /贵州茅台（600519\.SH）/);
});

test("非法股票提示具体支持的名称和代码", () => {
  const result = validateSchema(parseRequest("分析 X 公司最近 30 天的股价"));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /东方财富/);
  assert.match(result.errors.join(" "), /300059\.SZ/);
});
test("Schema 保留请求和解析后的来源", () => {
  const schema = createSchema({
    stockId: "A",
    days: 10,
    metrics: ["price", "change"],
    requestedSource: DATA_SOURCES.skillHub,
  });
  assert.equal(schema.requestedSource, "skill-hub");
  assert.equal(schema.resolvedSource, "skill-hub");
  assert.equal(validateSchema(schema).valid, true);
});
test("外部行情字段可归一化且绘图使用归一化行", () => {
  const rows = normalizeRows([
    {
      trade_date: "2026-10-20",
      close: 10.12,
      open: 10.4,
      pct_chg: -2.7,
      vol: 800,
    },
    {
      trade_date: "2026-10-21",
      close: 10.5,
      open: 10.12,
      pct_chg: 3.75,
      vol: 900,
    },
  ]);
  const schema = createSchema({
    stockId: "A",
    days: 10,
    metrics: ["price", "change"],
    requestedSource: "skill-hub",
  });
  const dashboard = buildDashboard(schema, rows);
  assert.equal(dashboard.rows[0].price, 10.12);
  assert.equal(dashboard.worst[0].change, -2.7);
});

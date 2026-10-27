import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_SOURCES,
  EXAMPLES,
  LOCAL_DATA_AS_OF,
  SAMPLE_DATA,
  applyFollowup,
  buildDashboard,
  getStockData,
  normalizeRows,
  parseRequest,
  validateSchema,
} from "../src/analysisEngine.js";

test("题目要求的五条示例都能确定性解析", () => {
  assert.equal(EXAMPLES.length >= 5, true);
  for (const example of EXAMPLES) {
    const schema = parseRequest(example);
    assert.equal(validateSchema(schema).valid, true, example);
    assert.ok(schema.stockName);
    assert.ok(schema.stockCode);
  }
});

test("三类图表 Schema 字段完整", () => {
  const schema = parseRequest("分析东方财富最近 30 天的股价和成交量");
  assert.deepEqual(schema.chartTypes, ["line", "bar", "ranking"]);
  for (const key of [
    "stockId",
    "metrics",
    "timeRange",
    "chartTypes",
    "title",
    "dataSource",
    "dataAsOf",
    "units",
  ]) assert.ok(schema[key], `缺少 Schema 字段 ${key}`);
  assert.equal(schema.requestedSource, DATA_SOURCES.local);
  assert.equal(schema.resolvedSource, DATA_SOURCES.local);
});

test("所有内置公司都有独立的可复现数据", () => {
  for (const stockId of Object.keys(SAMPLE_DATA)) {
    const first = getStockData(stockId, 30);
    const second = getStockData(stockId, 30);
    assert.equal(first.length, 30);
    assert.deepEqual(first, second);
    assert.ok(first.every((row) => row.price > 0 && row.volume > 0));
    assert.equal(first.at(-1).date, "10/24");
  }
  assert.equal(LOCAL_DATA_AS_OF, "2026-10-24 15:00");
  assert.equal(parseRequest("分析东方财富最近 30 天的股价").dataAsOf, LOCAL_DATA_AS_OF);
});

test("时间范围只允许题目支持的四个值", () => {
  for (const days of [10, 15, 20, 30]) {
    assert.equal(validateSchema(parseRequest(`分析贵州茅台最近 ${days} 天的股价`)).valid, true);
  }
  assert.equal(validateSchema(parseRequest("分析贵州茅台最近 11 天的股价")).valid, false);
  assert.equal(validateSchema(parseRequest("分析贵州茅台最近 31 天的股价")).valid, false);
});

test("Top-3 跌幅排序与结论使用同一批数据", () => {
  const schema = parseRequest("分析宁德时代最近 30 天的股价和成交量");
  const dashboard = buildDashboard(schema);
  assert.equal(dashboard.worst.length, 3);
  assert.deepEqual(
    dashboard.worst.map((row) => row.change),
    [...dashboard.rows].sort((a, b) => a.change - b.change).slice(0, 3).map((row) => row.change),
  );
  for (const row of dashboard.worst) assert.ok(dashboard.rows.some((item) => item.date === row.date));
  assert.match(dashboard.insight, /最大单日跌幅/);
});

test("追问只修改明确字段并保留来源和股票", () => {
  const schema = {
    ...parseRequest("分析东方财富最近 30 天的成交量"),
    requestedSource: DATA_SOURCES.skillHub,
    resolvedSource: DATA_SOURCES.local,
    fallbackReason: "测试回退",
  };
  const changed = applyFollowup("把成交量改成涨跌幅", schema).schema;
  assert.deepEqual(changed.metrics, ["price", "change"]);
  assert.equal(changed.stockId, "A");
  assert.equal(changed.timeRange.value, 30);
  assert.equal(changed.requestedSource, DATA_SOURCES.skillHub);
  assert.equal(changed.fallbackReason, "测试回退");
});

test("空数据和非法字段会被安全拒绝", () => {
  assert.throws(() => normalizeRows([]), /空数据/);
  assert.throws(() => normalizeRows([{ date: "2026-01-01", price: 1 }]), /无法识别/);
  const schema = parseRequest("分析东方财富最近 30 天的股价");
  const dashboard = buildDashboard(schema, []);
  assert.equal(dashboard.validation.valid, false);
  assert.deepEqual(dashboard.rows, []);
});

test("不支持的指标和来源不会污染有效 Schema", () => {
  const invalidMetric = parseRequest("分析东方财富最近 30 天的市盈率");
  assert.equal(validateSchema(invalidMetric).valid, false);
  const invalidSource = { ...parseRequest("分析东方财富最近 30 天的股价"), requestedSource: "unknown" };
  assert.equal(validateSchema(invalidSource).valid, false);
});

test("未内置公司返回数据不足提示，不错误分析为默认公司", () => {
  const schema = parseRequest("查询赛力斯最近 30 天的股价和成交量");
  assert.equal(schema.stockId, "赛力斯");
  const validation = validateSchema(schema);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /对不起，当前数据不足/);
});

test("未知公司选择 Skill Hub 时可用外部行情生成看板", () => {
  const schema = {
    ...parseRequest("查询赛力斯最近 10 天的股价和成交量"),
    stockName: "赛力斯",
    stockCode: "601127.SH",
    requestedSource: DATA_SOURCES.skillHub,
    resolvedSource: DATA_SOURCES.skillHub,
  };
  assert.equal(validateSchema(schema, { allowExternalStock: true }).valid, true);
  const rows = [
    { date: "2026-10-20", price: 100, open: 101, change: -1, volume: 1200 },
    { date: "2026-10-21", price: 102, open: 100, change: 2, volume: 1300 },
  ];
  const dashboard = buildDashboard(schema, rows);
  assert.equal(dashboard.validation.valid, true);
  assert.equal(dashboard.rows.length, 2);
  assert.match(dashboard.insight, /赛力斯/);
});

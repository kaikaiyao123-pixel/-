export const SAMPLE_DATA = {
  A: { name: "东方财富", code: "300059.SZ", base: 128.4, seed: 1 },
  B: { name: "贵州茅台", code: "600519.SH", base: 76.2, seed: 2 },
  C: { name: "宁德时代", code: "300750.SZ", base: 42.8, seed: 3 },
};
const STOCK_ALIASES = new Map([
  ["A", "A"],
  ["B", "B"],
  ["C", "C"],
  ["东方财富", "A"],
  ["300059.SZ", "A"],
  ["300059", "A"],
  ["贵州茅台", "B"],
  ["600519.SH", "B"],
  ["600519", "B"],
  ["宁德时代", "C"],
  ["300750.SZ", "C"],
  ["300750", "C"],
]);
export const SUPPORTED_RANGES = [10, 15, 20, 30];
export const METRIC_META = {
  price: { label: "收盘价", unit: "元" },
  volume: { label: "成交量", unit: "万股" },
  change: { label: "涨跌幅", unit: "%" },
};
export const DATA_SOURCES = { local: "local", skillHub: "skill-hub" };
export const DATA_SOURCE_LABELS = {
  local: "本地固定模拟数据",
  skillHub: "问财 Skill Hub",
};
export const LOCAL_DATA_AS_OF = "2026-10-24 15:00";
export function normalizeStockId(value = "") {
  const key = String(value)
    .trim()
    .replace(/[（）()]/g, "")
    .toUpperCase();
  return STOCK_ALIASES.get(key) || null;
}
const labels = [
  "09/15",
  "09/16",
  "09/17",
  "09/18",
  "09/19",
  "09/22",
  "09/23",
  "09/24",
  "09/25",
  "09/26",
  "09/29",
  "09/30",
  "10/01",
  "10/02",
  "10/03",
  "10/06",
  "10/07",
  "10/08",
  "10/09",
  "10/10",
  "10/13",
  "10/14",
  "10/15",
  "10/16",
  "10/17",
  "10/20",
  "10/21",
  "10/22",
  "10/23",
  "10/24",
];
const waves = [
  [
    0, 1.8, -0.7, 2.4, -1.1, 0.6, 1.1, -2.7, 1.7, -0.4, 2.2, -1.5, 0.9, -3.8,
    1.1, 1.6, -0.8, 2.9, -1.6, 0.7, -2.1, 1.4, 0.5, -4.4, 2.6, -1.2, 1.8, -0.6,
    2.1, -2.9,
  ],
  [
    0.8, -1.2, 2.2, 0.4, -2.4, 1.6, -0.8, 2.8, -1.5, 1.1, 0.4, -2.2, 1.9, -1.1,
    2.5, -0.7, 1.4, -2.9, 0.8, 1.9, -1.8, 0.5, -2.5, 1.2, 2.4, -0.9, 1.7, -1.6,
    0.6, -2.1,
  ],
  [
    0, -0.5, 1.2, -1.5, 2.2, -0.9, 1.8, -2.1, 0.4, 1.6, -1.1, 0.7, -2.8, 1.5,
    0.8, -1.7, 2.4, -0.6, 1.1, -2.5, 0.6, 1.7, -1.3, 2.2, -0.8, 1.4, -1.9, 0.5,
    1.8, -2.7,
  ],
];
export function getStockData(stock = "A", days = 30) {
  const s = SAMPLE_DATA[stock];
  if (!s) return [];
  const count = Math.min(days, 30);
  let price = s.base;
  return Array.from({ length: count }, (_, i) => {
    const pct = waves[s.seed - 1][30 - count + i] + (s.seed - 2) * 0.18;
    const open = price;
    price = +(price * (1 + pct / 100)).toFixed(2);
    return {
      date: labels[30 - count + i],
      price,
      open,
      change: +pct.toFixed(2),
      volume: Math.round(
        (680 + ((i * 83 + s.seed * 127) % 720)) * (1 + Math.abs(pct) / 8),
      ),
    };
  });
}
function sourceFields(
  source = DATA_SOURCES.local,
  fallbackReason = null,
  resolvedSource = source,
) {
  return {
    requestedSource: source,
    resolvedSource,
    dataSource: DATA_SOURCE_LABELS[resolvedSource] || resolvedSource,
    fallbackReason: fallbackReason || null,
  };
}
export function parseRequest(text = "", previous = null) {
  const input = text.trim();
  const stockMention = input.match(
    /(?:东方财富|贵州茅台|宁德时代|\d{6}(?:\.(?:SZ|SH))?|[A-Z])(?:公司)?/i,
  )?.[0];
  const unknownChineseCompany = input.match(
    /(?:分析|查看|看看|比较|查询|搜索|查找|研究|了解)\s*([\u4e00-\u9fa5]{2,8}?)(?:公司)?(?:最近|近|过去)/,
  )?.[1];
  const unknownCompanyWithoutRange = input.match(
    /(?:分析|查看|看看|比较|查询|搜索|查找|研究|了解)\s*([\u4e00-\u9fa5]{2,12}?)(?:公司)?(?:的|行情|股价|走势|$)/,
  )?.[1];
  const stock =
    normalizeStockId(stockMention) ||
    (stockMention ? stockMention.toUpperCase().replace(/公司$/i, "") : null) ||
    (unknownChineseCompany && !STOCK_ALIASES.has(unknownChineseCompany)
      ? unknownChineseCompany
      : null) ||
    (unknownCompanyWithoutRange && !STOCK_ALIASES.has(unknownCompanyWithoutRange)
      ? unknownCompanyWithoutRange
      : null) ||
    normalizeStockId(previous?.stockId) ||
    "A";
  const days = Number(
    input.match(/(?:最近|近|过去)\s*(\d+)\s*(?:天|个交易日)/)?.[1] ||
      previous?.timeRange?.value ||
      30,
  );
  const metric = /成交量|交易量|量能/.test(input)
    ? "volume"
    : /涨跌幅|收益率|回报/.test(input)
      ? "change"
      : /股价|收盘价|价格|走势/.test(input)
        ? "price"
        : "unsupported";
  const stockMeta = SAMPLE_DATA[stock] || { name: `${stock} 公司`, code: "" };
  return {
    stockId: stock,
    metrics: ["price", metric].filter((x, i, a) => a.indexOf(x) === i),
    timeRange: { type: "recent", value: days, unit: "交易日" },
    chartTypes: ["line", "bar", "ranking"],
    stockName: stockMeta.name,
    stockCode: stockMeta.code,
    title: `${stockMeta.name}（${stockMeta.code}）最近${days}天分析`,
    ...sourceFields(
      previous?.requestedSource || DATA_SOURCES.local,
      previous?.fallbackReason,
    ),
    dataAsOf: LOCAL_DATA_AS_OF,
    units: { price: "元", volume: "万股", change: "%" },
    highlight: "跌幅最大的 3 个交易日",
  };
}
export function applyFollowup(text, schema) {
  if (/涨跌幅|收益率|回报/.test(text))
    return { schema: { ...schema, metrics: ["price", "change"] } };
  if (/成交量|交易量|量能/.test(text))
    return { schema: { ...schema, metrics: ["price", "volume"] } };
  if (/最近|近|过去/.test(text) && /10/.test(text))
    return {
      schema: { ...schema, timeRange: { ...schema.timeRange, value: 10 } },
    };
  return { error: "仅支持改指标或改为最近 10 天。" };
}
export function validateSchema(s, options = {}) {
  const e = [];
  const knownStock = s && SAMPLE_DATA[normalizeStockId(s.stockId)];
  const allowExternalStock = options.allowExternalStock === true;
  if (!knownStock && !allowExternalStock)
    e.push(
      "对不起，当前数据不足：暂未内置该公司的可复现数据。请使用东方财富（300059.SZ）、贵州茅台（600519.SH）、宁德时代（300750.SZ）或 A、B、C。",
    );
  if (!s?.metrics?.length || s.metrics.some((m) => !METRIC_META[m]))
    e.push("指标不受支持，请使用收盘价、成交量或涨跌幅。");
  if (s?.metrics?.length > 2 || !s?.metrics?.includes("price"))
    e.push("Schema 必须包含收盘价，最多再选择一个指标。");
  if (!SUPPORTED_RANGES.includes(s?.timeRange?.value))
    e.push("时间范围需为最近 10、15、20 或 30 个交易日。");
  if (!s?.units || s.metrics.some((m) => !s.units[m])) e.push("缺少指标单位。");
  if (
    !Object.values(DATA_SOURCES).includes(
      s?.requestedSource || DATA_SOURCES.local,
    )
  )
    e.push("数据源不受支持，请选择本地模拟数据或问财 Skill Hub。");
  if (
    !Object.values(DATA_SOURCES).includes(
      s?.resolvedSource || DATA_SOURCES.local,
    )
  )
    e.push("已解析数据源不受支持。");
  return { valid: !e.length, errors: e };
}
export function createSchema(intent) {
  const stockId =
      normalizeStockId(intent.stockId) ||
      String(intent.stockId || "").toUpperCase(),
    metrics = Array.isArray(intent.metrics) ? intent.metrics : [],
    days = Number(intent.days),
    requestedSource = intent.requestedSource || DATA_SOURCES.local;
  return {
    stockId,
    metrics,
    timeRange: { type: "recent", value: days, unit: "交易日" },
    chartTypes: ["line", "bar", "ranking"],
    title: `${SAMPLE_DATA[stockId]?.name || intent.stockName || stockId}（${SAMPLE_DATA[stockId]?.code || intent.stockCode || "外部数据"}）最近${days}天分析`,
    stockName: SAMPLE_DATA[stockId]?.name || String(intent.stockName || stockId),
    stockCode: SAMPLE_DATA[stockId]?.code || String(intent.stockCode || ""),
    ...sourceFields(requestedSource, intent.fallbackReason),
    dataAsOf: LOCAL_DATA_AS_OF,
    units: { price: "元", volume: "万股", change: "%" },
    highlight: "跌幅最大的 3 个交易日",
  };
}
export function normalizeRows(rows) {
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("数据源返回了空数据。");
  const normalized = rows.map((row) => {
    const date = String(row.date ?? row.trade_date ?? row.datetime ?? "").slice(
      0,
      10,
    );
    const price = Number(row.price ?? row.close ?? row.close_price);
    const open = Number(row.open ?? row.open_price ?? price);
    const change = Number(row.change ?? row.pct_chg ?? row.change_percent);
    const volume = Number(row.volume ?? row.vol ?? row.amount);
    if (!date || ![price, open, change, volume].every(Number.isFinite))
      throw new Error("数据源返回了无法识别的行情字段。");
    return {
      date,
      price: +price.toFixed(2),
      open: +open.toFixed(2),
      change: +change.toFixed(2),
      volume: Math.round(volume),
    };
  });
  return normalized;
}
export function buildDashboard(s, rowsOverride = null) {
  const validation = validateSchema(s, { allowExternalStock: Boolean(rowsOverride) && s.resolvedSource === DATA_SOURCES.skillHub });
  if (!validation.valid) return { validation, rows: [] };
  let rows;
  try {
    rows = rowsOverride
      ? normalizeRows(rowsOverride)
      : getStockData(s.stockId, s.timeRange.value);
  } catch (error) {
    return { validation: { valid: false, errors: [error.message] }, rows: [] };
  }
  const worst = [...rows].sort((a, b) => a.change - b.change).slice(0, 3),
    total = rows.length
      ? ((rows.at(-1).price / rows[0].price - 1) * 100).toFixed(2)
      : "0.00";
  return {
    validation,
    rows,
    worst,
    insight: `${s.timeRange.value} 个交易日内，${s.stockName || SAMPLE_DATA[s.stockId]?.name || s.stockId}股价${total >= 0 ? "上涨" : "下跌"} ${Math.abs(total)}%，最大单日跌幅为 ${worst[0]?.change?.toFixed(2) || "0.00"}%。`,
  };
}
export const EXAMPLES = [
  "分析东方财富最近 30 天的股价和成交量。",
  "看看贵州茅台最近 10 天的涨跌幅。",
  "分析宁德时代最近 20 天的股价走势。",
  "查看贵州茅台近 15 个交易日的成交量变化。",
  "比较东方财富最近 10 天的股价和涨跌幅。",
];

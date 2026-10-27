import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DATA_SOURCES,
  DATA_SOURCE_LABELS,
  EXAMPLES,
  METRIC_META,
} from "./analysisEngine.js";
import "./styles.css";
import "./agent.css";
import "./report.css";
import "./minimal-ui.css";
import "./source.css";

const stages = [
  "理解请求",
  "构建分析 Schema",
  "校验 Schema",
  "准备模拟数据",
  "生成分析结论",
  "完成",
];

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim())
    throw new Error(
      `分析服务返回空响应（HTTP ${response.status}）。请确认本地后端已重启。`,
    );
  try {
    return JSON.parse(text);
  } catch {
    const hint = text.trim().startsWith("<")
      ? "收到 HTML 页面而不是 API 数据，请确认访问的是后端服务端口。"
      : text.slice(0, 180);
    throw new Error(`分析服务响应格式无效（HTTP ${response.status}）：${hint}`);
  }
}

const CHART = {
  width: 760,
  height: 260,
  left: 58,
  right: 16,
  top: 16,
  bottom: 42,
};
const DOWN_COLOR = "#2EA36B";
const DOWN_FILL = "rgba(46,163,107,.08)";

function getTicks(min, max, count = 4) {
  if (min === max) return Array.from({ length: count }, () => min);
  return Array.from(
    { length: count },
    (_, index) => min + ((max - min) * index) / (count - 1),
  );
}

function formatValue(value, metric) {
  return metric === "price"
    ? value.toFixed(2)
    : Math.round(value).toLocaleString("zh-CN");
}

function chartGeometry(rows, metric) {
  const values = rows.map((row) => row[metric]);
  const min =
    metric === "price"
      ? Math.min(...values)
      : metric === "volume"
        ? 0
        : Math.min(...values, 0);
  const max = metric === "price" ? Math.max(...values) : Math.max(...values, 1);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index) =>
    CHART.left + (index / Math.max(rows.length - 1, 1)) * plotWidth;
  const y = (value) =>
    CHART.top + ((max - value) / (max - min || 1)) * plotHeight;
  return { values, min, max, plotWidth, x, y, ticks: getTicks(min, max) };
}

function TopThreeLegend({ worst = [] }) {
  return (
    <ol className="drawdown-legend" aria-label="跌幅最大的三个交易日">
      {worst.map((row, index) => (
        <li key={row.date}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <span>{row.date}</span>
          <strong>{row.change.toFixed(2)}%</strong>
        </li>
      ))}
    </ol>
  );
}

function TopThreeBands({ rows, worst = [], x }) {
  return worst.map((row, index) => {
    const rowIndex = rows.findIndex((item) => item.date === row.date);
    const pointX = x(rowIndex);
    return (
      <g key={row.date} className="drawdown-marker">
        <rect
          x={pointX - 13}
          y={CHART.top}
          width="26"
          height={CHART.height - CHART.top - CHART.bottom}
          fill={DOWN_FILL}
        />
        <circle cx={pointX} cy={CHART.top + 12} r="10" fill={DOWN_COLOR} />
        <text x={pointX} y={CHART.top + 16} textAnchor="middle">
          {index + 1}
        </text>
      </g>
    );
  });
}

function ChartGrid({ ticks, y, metric }) {
  return ticks.map((tick) => (
    <g key={`${metric}-${tick}`}>
      <line
        x1={CHART.left}
        y1={y(tick)}
        x2={CHART.width - CHART.right}
        y2={y(tick)}
        className="chart-gridline"
      />
      <text
        x={CHART.left - 10}
        y={y(tick) + 4}
        textAnchor="end"
        className="chart-axis-label"
      >
        {formatValue(tick, metric)}
      </text>
    </g>
  ));
}

function LineChart({ rows, worst = [] }) {
  const geometry = chartGeometry(rows, "price");
  const points = rows
    .map((row, index) => `${geometry.x(index)},${geometry.y(row.price)}`)
    .join(" ");
  return (
    <svg
      className="line-chart"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label="收盘价折线图，标记跌幅最大的三个交易日"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ChartGrid ticks={geometry.ticks} y={geometry.y} metric="price" />
      <polygon
        points={`${CHART.left},${CHART.height - CHART.bottom} ${points} ${CHART.width - CHART.right},${CHART.height - CHART.bottom}`}
        fill="url(#priceFill)"
      />
      <TopThreeBands rows={rows} worst={worst} x={geometry.x} />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {rows.map((row, index) => (
        <circle
          key={row.date}
          cx={geometry.x(index)}
          cy={geometry.y(row.price)}
          r={worst.some((item) => item.date === row.date) ? 4 : 2.5}
          fill={
            worst.some((item) => item.date === row.date)
              ? DOWN_COLOR
              : "currentColor"
          }
        >
          <title>
            {row.date} · {row.change}%
          </title>
        </circle>
      ))}
    </svg>
  );
}

function Bars({ rows, metric, worst = [] }) {
  const geometry = chartGeometry(rows, metric);
  const barWidth = Math.max(4, geometry.plotWidth / rows.length - 3);
  return (
    <svg
      className="bar-chart"
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={`${METRIC_META[metric].label}柱状图`}
      preserveAspectRatio="xMidYMid meet"
    >
      <ChartGrid ticks={geometry.ticks} y={geometry.y} metric={metric} />
      <line
        x1={CHART.left}
        y1={geometry.y(0)}
        x2={CHART.width - CHART.right}
        y2={geometry.y(0)}
        className="chart-baseline"
      />
      {rows.map((row, index) => {
        const valueY = geometry.y(row[metric]);
        const baselineY = geometry.y(0);
        return (
          <rect
            key={row.date}
            x={geometry.x(index) - barWidth / 2}
            y={Math.min(valueY, baselineY)}
            width={barWidth}
            height={Math.abs(baselineY - valueY)}
            className="chart-bar"
          >
            <title>
              {row.date}: {formatValue(row[metric], metric)}{" "}
              {metric === "volume" ? "万手" : METRIC_META[metric].unit}
            </title>
          </rect>
        );
      })}
      <TopThreeBands rows={rows} worst={worst} x={geometry.x} />
    </svg>
  );
}

function DrawdownChart({ worst = [] }) {
  const width = 760;
  const height = 220;
  const left = 150;
  const max = Math.max(...worst.map((row) => Math.abs(row.change)), 1);
  return (
    <svg className="drawdown-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="跌幅最大的三个交易日横向排名图">
      {worst.map((row, index) => {
        const y = 30 + index * 58;
        const barWidth = ((Math.abs(row.change) / max) * (width - left - 36));
        return <g key={row.date}>
          <text x={left - 12} y={y + 17} textAnchor="end" className="chart-axis-label">{row.date}</text>
          <rect x={left} y={y} width={barWidth} height="28" className="drawdown-bar" />
          <text x={left + barWidth + 8} y={y + 19} className="drawdown-value">{row.change.toFixed(2)}%</text>
        </g>;
      })}
    </svg>
  );
}

function App() {
  const [request, setRequest] = useState(EXAMPLES[0]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState(-1);
  const [followup, setFollowup] = useState("");
  const [source, setSource] = useState(DATA_SOURCES.local);
  const [sessionId, setSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [view, setView] = useState("reports");
  const [historyOpen, setHistoryOpen] = useState(false);
  const reportRef = useRef(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((response) => response.ok ? response.json() : [])
      .then((items) => setSessions(Array.isArray(items) ? items : []))
      .catch(() => setSessions([]));
  }, []);

  async function createNewSession() {
    setError("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "新建股票分析" }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || "新建会话失败");
      setSessionId(payload.id);
      setSessions((current) => [payload, ...current]);
      setResult(null);
      setRequest(EXAMPLES[0]);
      setFollowup("");
      setView("reports");
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause.message || "新建会话失败");
    }
  }

  async function openSession(id) {
    setError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || "打开会话失败");
      const messages = payload.messages || [];
      const latest = [...messages].reverse().find((message) => message.role === "assistant" && message.schema);
      setSessionId(id);
      setResult(latest ? { ...latest, sessionId: id, schema: latest.schema, dashboard: latest.dashboard, stages: latest.stages, mode: latest.mode } : null);
      setView("reports");
      setHistoryOpen(false);
    } catch (cause) {
      setError(cause.message || "打开会话失败");
    }
  }

  async function submit(text = request, previousSchema = null) {
    setRequest(text);
    setResult(previousSchema ? result : null);
    setError("");
    setWorking(true);
    setStage(0);
    const timer = window.setInterval(
      () => setStage((current) => Math.min(current + 1, stages.length - 2)),
      450,
    );
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request: text,
          previousSchema,
          sessionId,
          source: previousSchema?.requestedSource || source,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw new Error(payload.error || "请求处理失败");
      setResult(payload);
      if (payload.sessionId) setSessionId(payload.sessionId);
      if (payload.sessionId && !sessions.some((item) => item.id === payload.sessionId)) {
        setSessions((current) => [{ id: payload.sessionId, title: text.slice(0, 28), createdAt: new Date().toISOString() }, ...current]);
      }
      setStage(stages.length - 1);
      window.setTimeout(
        () =>
          reportRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        40,
      );
    } catch (cause) {
      setError(cause.message || "无法连接分析服务");
    } finally {
      window.clearInterval(timer);
      setWorking(false);
    }
  }

  function submitFollowup(event) {
    event.preventDefault();
    if (followup.trim() && result) {
      submit(followup.trim(), result.schema);
      setFollowup("");
    }
  }

  const secondary =
    result?.schema.metrics.find((metric) => metric !== "price") || "volume";
  const dataAsOf =
    result?.schema.dataAsOf?.slice(0, 10).replaceAll("-", ".") || "—";
  return (
    <div className="codex-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <b>SD</b>
          <span>Signal Desk</span>
        </div>
        <button
          className="new-report"
          onClick={createNewSession}
          disabled={working}
        >
          ＋ 新建分析
        </button>
        <nav>
          <span>工作区</span>
          <button className={view === "reports" ? "active" : ""} onClick={() => setView("reports")}>分析报告</button>
          <button className={view === "data" ? "active" : ""} onClick={() => setView("data")}>数据口径</button>
          <button className={historyOpen ? "active" : ""} onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>运行记录 <span className="nav-caret">{historyOpen ? "⌃" : "⌄"}</span></button>
          {historyOpen && <div className="history-dropdown" role="menu">
            {sessions.length ? sessions.slice(0, 8).map((item) => <button key={item.id} role="menuitem" onClick={() => openSession(item.id)}><strong>{item.title || "股票分析"}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : item.id}</small></button>) : <span className="history-empty">暂无运行记录</span>}
          </div>}
        </nav>
        <div className="sidebar-bottom">
          <span>本地模拟数据</span>
          <small>Agent ready</small>
        </div>
      </aside>
      <main>
        {view === "data" && <section className="workspace-panel"><label>DATA DICTIONARY</label><h2>数据口径</h2><p>支持东方财富、贵州茅台、宁德时代；时间范围为最近 10、15、20 或 30 个交易日。行情来自固定模拟数据或可选的问财 Skill Hub 适配器。</p><p>收盘价单位：元；成交量单位：万股；涨跌幅单位：%。数据仅用于演示，不构成投资建议。</p></section>}
        <header className="app-header">
          <b>SD</b>
          <div>
            <strong>SIGNAL DESK</strong>
            <small>股票分析工作台</small>
          </div>
          <span className="offline">
            <i />
            离线模拟行情
          </span>
        </header>
        {view === "reports" && <section className="hero">
          <div>
            <label>STOCK ANALYSIS / 工作区</label>
            <h1>股票分析报告</h1>
            <p>用自然语言描述股票、指标和时间范围，生成可追溯的图表与结论。</p>
          </div>
          <span className="hero-asof">
            数据截止
            <br />
            <strong>{dataAsOf}</strong>
          </span>
        </section>}
        {view === "reports" && <section className="query">
          <label htmlFor="source">行情数据源</label>
          <select
            id="source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={working}
          >
            <option value={DATA_SOURCES.local}>
              {DATA_SOURCE_LABELS.local}
            </option>
            <option value={DATA_SOURCES.skillHub}>
              {DATA_SOURCE_LABELS.skillHub}
            </option>
          </select>
          <label htmlFor="request">分析指令</label>
          <textarea
            id="request"
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
                submit();
            }}
            placeholder="例如：分析东方财富最近 30 天的股价和成交量"
          />
          <button
            disabled={working || !request.trim()}
            onClick={() => submit()}
          >
            {working ? "正在生成…" : "生成报告"}
            <span>↗</span>
          </button>
          <div className="examples">
            <span>示例指令</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                disabled={working}
                onClick={() => submit(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </section>}
        {view === "reports" && <section className="workflow" aria-live="polite">
          <div className="workflow-heading">
            <label>生成流程</label>
            <span>
              {working
                ? "处理中"
                : result
                  ? "已完成"
                  : stage >= 0
                    ? "请检查输入后重试"
                    : "就绪"}
            </span>
          </div>
          <div className="steps">
            {stages.map((name, index) => (
              <div
                key={name}
                className={
                  index < stage ? "done" : index === stage ? "active" : ""
                }
              >
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>{name}</span>
              </div>
            ))}
          </div>
        </section>}
        {error && (
          <div className="error" role="alert">
            <strong>分析未完成</strong>
            <span>{error}</span>
            {error.includes("OPENAI_API_KEY") && (
              <small>
                在启动服务的终端设置 OPENAI_API_KEY；可选设置 OPENAI_BASE_URL 和
                OPENAI_MODEL。
              </small>
            )}
          </div>
        )}
        {view === "reports" && result && (
          <>
            <section className="report" ref={reportRef}>
              <div className="report-heading">
                <div>
                  <label>ANALYSIS REPORT</label>
                  <h2>{result.schema.title}</h2>
                  <p>
                    {result.schema.stockName}（{result.schema.stockCode}） ·
                    最近 {result.schema.timeRange.value} 个交易日
                  </p>
                </div>
                <span className="report-mode">
                  {result.mode === "local-rules" ? "本地分析" : result.model}
                </span>
              </div>
              <div className="source-meta">
                <span>
                  请求来源：{DATA_SOURCE_LABELS[result.schema.requestedSource]}
                </span>
                <span>
                  实际来源：{DATA_SOURCE_LABELS[result.schema.resolvedSource]}
                </span>
                <span>数据截止：{result.schema.dataAsOf}</span>
              </div>
              {result.schema.fallbackReason && (
                <div className="fallback-note" role="status">
                  {result.schema.fallbackReason}
                </div>
              )}
              {result.unavailable || !result.dashboard.rows.length ? (
                <div className="fallback-note" role="status">
                  {result.notice || "暂无可用行情数据，已生成结构化 Schema，但不显示图表。请配置该公司的行情接口和 API Key 后重试。"}
                </div>
              ) : <section className="charts">
                <article className="chart-panel">
                  <div className="chart-heading">
                    <div>
                      <label>PRICE TREND</label>
                      <h3>收盘价走势</h3>
                    </div>
                    <span>元</span>
                  </div>
                  <LineChart
                    rows={result.dashboard.rows}
                    worst={result.dashboard.worst}
                  />
                  <div className="chart-dates">
                    <span>{result.dashboard.rows[0]?.date}</span>
                    <span>{result.dashboard.rows.at(-1)?.date}</span>
                  </div>
                  <TopThreeLegend worst={result.dashboard.worst} />
                </article>
                <article className="chart-panel">
                  <div className="chart-heading">
                    <div>
                      <label>{secondary.toUpperCase()}</label>
                      <h3>{METRIC_META[secondary].label}</h3>
                    </div>
                    <span>
                      {secondary === "volume"
                        ? "万手"
                        : METRIC_META[secondary].unit}
                    </span>
                  </div>
                  <Bars
                    rows={result.dashboard.rows}
                    metric={secondary}
                    worst={result.dashboard.worst}
                  />
                  <div className="chart-dates">
                    <span>{result.dashboard.rows[0]?.date}</span>
                    <span>{result.dashboard.rows.at(-1)?.date}</span>
                  </div>
                  <TopThreeLegend worst={result.dashboard.worst} />
                </article>
                <article className="chart-panel chart-panel-wide">
                  <div className="chart-heading"><div><label>DRAWDOWN RANKING</label><h3>跌幅最大的三个交易日</h3></div><span>%</span></div>
                  <DrawdownChart worst={result.dashboard.worst} />
                  <TopThreeLegend worst={result.dashboard.worst} />
                </article>
              </section>}
              {result.dashboard.insight && <div className="insight">
                <div className="insight-mark">✦</div>
                <div>
                  <label>分析结论</label>
                  <p>{result.dashboard.insight}</p>
                </div>
              </div>}
              <details className="schema">
                <summary>
                  <span>查看结构化 Schema</span>
                  <span className="model-label">
                    {result.mode === "local-rules"
                      ? "本地规则引擎"
                      : result.model}
                  </span>
                </summary>
                <pre>{JSON.stringify(result.schema, null, 2)}</pre>
              </details>
              <form className="followup" onSubmit={submitFollowup}>
                <div>
                  <label>继续追问 / ONE FOLLOW-UP</label>
                  <small>保留未修改字段，只变更你明确提出的条件。</small>
                </div>
                <input
                  value={followup}
                  onChange={(event) => setFollowup(event.target.value)}
                  placeholder="例如：把成交量改成涨跌幅，或改为最近 10 天"
                  disabled={working}
                />
                <button disabled={working || !followup.trim()}>应用 ↗</button>
              </form>
              <footer>
                {result.schema.dataSource} · 截止 {result.schema.dataAsOf} ·
                模拟数据，不构成投资建议
              </footer>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

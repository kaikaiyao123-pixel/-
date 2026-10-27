# Signal Desk

自然语言股票分析 Agent 演示。前端请求进入本地 Node 后端，由后端构建分析上下文并调用 OpenAI 兼容 Chat Completions API；模型负责生成分析 Schema，后端校验后再用固定模拟行情计算图表和结论。行情不实时，也不构成投资建议。

## 启动

Node.js 20+。先在启动服务的终端设置服务端模型配置，再运行：

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-4o-mini"
npm run dev
```

只需要 `OPENAI_API_KEY`；兼容 OpenAI Chat Completions 的服务可用 `OPENAI_BASE_URL` 和 `OPENAI_MODEL` 覆盖。密钥不会传到浏览器。服务启动后访问 `http://127.0.0.1:5173`。没有配置模型密钥时，仍可使用本地规则解析。

分析表单可选择 `local`（本地固定模拟数据）或 `skill-hub`（问财 Skill Hub）。Skill Hub 仅在服务端配置：

```powershell
$env:WENCAI_SKILL_HUB_URL="https://your-skill-hub.example/query"
$env:WENCAI_SKILL_HUB_TOKEN="server-only-token"
$env:WENCAI_SKILL_HUB_TIMEOUT_MS="5000"
$env:WENCAI_SKILL_HUB_MOCK="success"
```

Skill Hub 的明确契约是：服务端 POST JSON `{stockId, days, metrics}`，可选 Bearer token 位于服务端环境变量；响应为 `{rows, dataAsOf}`（也兼容 `data` 或直接数组），每行需包含 `date`, `price|close`, `open`, `change|pct_chg`, `volume|vol`。默认超时 5000ms。服务端先尝试 Skill Hub，只有 HTTP/鉴权错误、超时、无效 JSON、字段错误或空数据才回退本地，并返回 `requestedSource`、`resolvedSource`、`fallbackReason`。

你提供的页面地址是 [`https://www.iwencai.com/skillhub`](https://www.iwencai.com/skillhub)，它是 Skill Hub 网页控制台（返回 HTML），不是可直接用于行情查询的 JSON API endpoint。项目已将其记录为 `WENCAI_SKILL_HUB_PAGE_URL`；只有拿到实际 JSON 查询接口后，才应填写 `WENCAI_SKILL_HUB_URL`。在此之前可用 `WENCAI_SKILL_HUB_MOCK=success` 验证完整 Skill Hub 成功路径。

不需要网络或凭证时，`WENCAI_SKILL_HUB_MOCK=success npm run dev` 启用确定性本地 Mock；`fail`、`empty`、`invalid` 可复现三种回退路径。Mock 返回与本地相同的归一化行结构。

## 部署架构说明

本项目暂不采用独立前后端部署，保持“Node 原生 HTTP + Vite middleware”单进程结构。原因是这是一个本地演示和评审项目：前端只调用同源 `/api/*`，不需要额外配置 API 域名、CORS、反向代理或两个进程；会话历史也由同一个 Node 进程写入项目内的 `data/sessions/*.json`，便于压缩后直接交付和恢复。

因此接收压缩包的一方只需在项目根目录执行 `npm install` 和 `npm run dev`，访问 `http://127.0.0.1:5173` 即可。部署时应保留 `data/sessions` 目录的读写权限，并通过环境变量配置可选的模型或 Skill Hub 服务端密钥；这些密钥不会进入浏览器。

拆分前后端会增加独立端口/进程、前端 API 地址、CORS 或反向代理、静态资源发布和会话目录挂载等部署步骤。目前没有多实例、独立扩缩容或跨域客户端需求，这些成本无法带来相应收益，所以不作为本项目的默认交付方式。只有在需要独立发布前端、水平扩展 API 或由多个客户端共享后端时，才应再进行拆分。

## Agent 工作流

浏览器提交 `/api/analyze`（包含 `source`）→ 后端构建分析上下文 → 解析股票、时间范围和指标 → 选择来源适配器并归一化 → 后端验证 Schema → 计算图表、Top-3 跌幅和结论 → 返回前端。响应 Schema 同时包含 `requestedSource`、`resolvedSource` 和可为空的 `fallbackReason`。

支持东方财富（300059.SZ）、贵州茅台（600519.SH）、宁德时代（300750.SZ），也兼容 A/B/C 标识；支持最近 10/15/20/30 个交易日，收盘价、成交量和涨跌幅。成功后支持一次跟进修改。报告包含价格折线、指标柱状和 Top-3 跌幅横向排名图，三者复用同一 `dashboard.worst`。模型只做意图解析，不会生成虚构行情数值；所有行情仍为模拟数据，不代表真实行情。

## 验证

```powershell
npm test
npm run build
```

## 提交材料与加分项

- `docs/natural-language-examples.md` 提供 5 条“输入 → Schema → 图表/结论”完整样例，另含追问和错误样例。
- `docs/schema/visualization-schema.example.json` 是可直接对照的 Schema 示例。
- `docs/dataset.json` 保存内置模拟数据口径；`docs/agent-conversation.md` 保存 Agent 协作记录。
- 额外加分项包括：具体公司名称与股票代码归一化、Skill Hub 成功/失败/空数据/非法数据 Mock、请求来源与实际来源分离、三类图表、Top-3 跌幅标记、会话历史和响应异常保护。

五个可复现提示词：

1. `分析东方财富最近 30 天的股价和成交量。` 返回 line + bar + drawdown。
2. `看看贵州茅台最近 10 天的涨跌幅。` 返回 price + change。
3. `分析宁德时代最近 20 天的股价走势。` 返回 price line。
4. `查看贵州茅台近 15 个交易日的成交量变化。` 返回 volume bar。
5. 生成报告后输入 `把成交量改成涨跌幅，改为最近 10 天`，保留来源并更新图表。

`src/analysisEngine.js` 包含 Schema、模拟行情和分析逻辑；`server.js` 负责 Agent 上下文、模型 API、数据源适配和后端校验；`src/main.jsx` 是前端工作台。

## 已知限制

`https://www.iwencai.com/skillhub` 是 Skill Hub 网页控制台，不是项目可以直接假定的行情 JSON 地址。真实 Skill Hub 地址必须由部署者通过 `WENCAI_SKILL_HUB_URL` 提供；没有该地址时，`WENCAI_SKILL_HUB_MOCK=success` 提供完全离线、确定性的成功路径。所有行情均为演示数据，不构成投资建议。

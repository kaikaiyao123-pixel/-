# 自然语言样例

以下样例与当前实现的解析词汇、Schema 字段和模拟数据完全一致，均可离线确定性复现。

1. **旗舰样例**：`分析东方财富最近 30 天的股价和成交量，并标出跌幅最大的 3 个交易日。`
   - Schema：`stockId=A`、`stockName=东方财富`、`stockCode=300059.SZ`、`metrics=[price, volume]`、`timeRange=30 交易日`、`chartTypes=[line, bar, ranking]`。
   - 结果：价格折线图、成交量柱状图、跌幅 Top-3 横向排名图；结论由同一批 30 条模拟行情计算。
2. `看看贵州茅台最近 10 天的涨跌幅。`
   - Schema：`stockId=B`、`stockName=贵州茅台`、`stockCode=600519.SH`、`metrics=[price, change]`、`timeRange=10 交易日`。
   - 结果：收盘价折线图、涨跌幅柱状图和 Top-3 跌幅标记。
3. `分析宁德时代最近 20 天的股价走势。`
   - Schema：`stockId=C`、`stockName=宁德时代`、`stockCode=300750.SZ`、`metrics=[price]`、`timeRange=20 交易日`。
   - 结果：收盘价折线图；第二指标缺省时仍安全显示成交量图位。
4. `查看贵州茅台近 15 个交易日的成交量变化。`
   - Schema：`stockId=B`、`metrics=[price, volume]`、`timeRange=15 交易日`、单位为元/万股。
   - 结果：收盘价折线图、成交量柱状图、跌幅排名图。
5. `比较东方财富最近 10 天的股价和涨跌幅。`
   - Schema：`stockId=A`、`metrics=[price, change]`、`timeRange=10 交易日`。
   - 结果：折线、涨跌幅柱状图和 Top-3 跌幅排名。

追问样例：在第 1 条完成后输入 `把成交量改成涨跌幅`，Schema 只把 `volume` 替换为 `change`；输入 `改为最近 10 天`，只把时间范围改为 10 个交易日，并保留股票和数据源。

错误样例：`分析 X 公司最近 11 天的市盈率` 会返回股票、指标和时间范围三项可读错误，不清空输入框，也不渲染无效旧结果。

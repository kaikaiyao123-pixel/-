export const MAX_HISTORY_MESSAGES = 12;
export const MAX_SCHEMA_CONTEXT_CHARS = 1200;

function compactSchema(schema) {
  const serialized = JSON.stringify(schema);
  if (serialized.length <= MAX_SCHEMA_CONTEXT_CHARS) return schema;
  return {
    stockId: schema.stockId,
    stockName: schema.stockName,
    days: schema.timeRange?.value ?? schema.days,
    metrics: schema.metrics,
  };
}

export function buildPromptMessages({
  systemContext,
  request,
  previousSchema,
  history,
}) {
  const historyMessages = Array.isArray(history)
    ? history.slice(-MAX_HISTORY_MESSAGES)
    : [];
  const historyText = historyMessages
    .map((message) => {
      const schema = message.schema ? compactSchema(message.schema) : null;
      return `${message.role}: ${message.content}${schema ? ` schema=${JSON.stringify(schema)}` : ""}`;
    })
    .join("\n");
  const followupContext = previousSchema
    ? compactSchema(previousSchema)
    : null;
  const messages = [
    { role: "system", content: systemContext },
    {
      role: "user",
      content: `历史上下文：\n${historyText}\n\n分析请求：${request}${followupContext ? `\n\n这是上一轮 Schema，请只修改用户明确要求的字段并保留其他字段：${JSON.stringify(followupContext)}` : ""}\n\n请只提取股票标识、交易日范围、指标和简短标题。`,
    },
  ];
  return {
    messages,
    historyMessageCount: historyMessages.length,
    promptTokenEstimate: Math.ceil(JSON.stringify(messages).length / 4),
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../src/analysisEngine.js";

test("搜索未知公司不会回退为东方财富", () => {
  const schema = parseRequest("搜索赛力斯最近 30 天的股价和成交量");
  assert.equal(schema.stockId, "赛力斯");
  assert.equal(schema.stockName, "赛力斯 公司");
  assert.notEqual(schema.stockId, "A");
});

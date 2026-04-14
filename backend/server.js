const express = require("express");
const cors = require("cors");
const { search } = require("./esQuery");

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------- 中间件 ---------- */

app.use(cors());
app.use(express.json());

/* ---------- 路由 ---------- */

const VALID_LOGIC = new Set(["match", "and", "or", "not"]);

/**
 * POST /api/search
 *
 * 请求体:
 *   keyword           string   搜索关键词（必填）
 *   logic             string   查询逻辑: "match" | "and" | "or"（默认 "match"）
 *   use_custom_ranking boolean  是否启用综合排序（默认 false）
 *   page              number   页码，从 1 开始（默认 1）
 *   page_size         number   每页条数（默认 50）
 *
 * 响应体:
 *   { hits: [...], took: "0.02" }
 */
app.post("/api/search", async (req, res) => {
  try {
    const {
      keyword,
      logic = "match",
      use_custom_ranking: useCustomRanking = false,
      exclude = "",
      page = 1,
      page_size: pageSize = 50,
    } = req.body;

    // --- 输入校验 ---
    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return res.status(400).json({ error: "参数 keyword 不能为空" });
    }

    if (!VALID_LOGIC.has(logic)) {
      return res.status(400).json({
        error: `参数 logic 必须为 match / and / or，收到: "${logic}"`,
      });
    }

    const from = (Math.max(1, parseInt(page, 10) || 1) - 1) * Math.min(parseInt(pageSize, 10) || 50, 200);
    const size = Math.min(parseInt(pageSize, 10) || 50, 200);

    // --- 执行搜索 ---
    // NOT 模式下基础查询逻辑用 match，排除词通过 exclude 传入
    const result = await search({
      keyword: keyword.trim(),
      logic: logic === "not" ? "match" : logic,
      useCustomRanking: Boolean(useCustomRanking),
      from,
      size,
      exclude: logic === "not" ? (typeof exclude === "string" ? exclude : "") : "",
    });

    return res.json(result);
  } catch (err) {
    console.error("[搜索错误]", err.message);
    return res.status(502).json({ error: "搜索服务暂时不可用，请确认 Elasticsearch 已启动" });
  }
});

/**
 * GET /api/health
 * 健康检查接口，同时检测 ES 连接状态
 */
app.get("/api/health", async (_req, res) => {
  const esHost = process.env.ES_HOST || "http://localhost:9200";
  try {
    const esRes = await fetch(esHost);
    if (!esRes.ok) throw new Error(`ES responded ${esRes.status}`);
    return res.json({ status: "ok", es: "connected" });
  } catch {
    return res.json({ status: "degraded", es: "unreachable" });
  }
});

/* ---------- 启动 ---------- */

app.listen(PORT, () => {
  console.log(`EduSearch 后端已启动: http://localhost:${PORT}`);
  console.log(`ES 地址: ${process.env.ES_HOST || "http://localhost:9200"}`);
  console.log(`ES 索引: ${process.env.ES_INDEX || "course_qa"}`);
});

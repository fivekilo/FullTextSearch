// ==========================================
// EduSearch - 模块 3: 检索质量评测脚本
//
// 评测思路：用每个问题作为查询词，评估 ES 能否返回
// 属于该问题的回答（而非其他问题的回答）。
//
// 核心指标:
//   Precision@K  — Top K 条结果中，属于正确问题的比例
//   MRR          — 第一条正确结果出现的位置的倒数
//   MAP          — 每个正确命中位置处的精度均值
//
// 分别评测:
//   1) Baseline: 纯 BM25 文本匹配
//   2) 综合排序: BM25 × quality 加权
// ==========================================

const fs = require('fs');
const path = require('path');
const { buildSearchBody } = require('../backend/esQuery');

const ES_HOST = 'http://localhost:9200';
const ES_INDEX = 'course_qa';
const DATA_PATH = path.join(__dirname, '../data/course_qa.json');
const K = 10; // Precision@K / 取前 K 条结果

// --- 1. 加载数据集：提取所有问题 ---
function loadQueries() {
  const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
  const qaData = JSON.parse(rawData.replace(/^\uFEFF/, ""));
  const queries = [];

  for (const [dataset, items] of Object.entries(qaData)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      queries.push({
        question: item.question,
        dataset,
        question_id: item.id,
        answerCount: item.answers.length,
      });
    }
  }
  return queries;
}

// --- 2. 指标计算函数 ---

/**
 * Precision@K：Top K 中属于正确问题的比例
 */
function precisionAtK(hits, dataset, questionId, k) {
  const topK = hits.slice(0, k);
  if (topK.length === 0) return 0;
  const relevant = topK.filter(
    h => h._source.dataset === dataset && h._source.question_id === questionId
  );
  return relevant.length / topK.length;
}

/**
 * MRR：第一条属于正确问题的结果排在第几位（取倒数）
 */
function reciprocalRank(hits, dataset, questionId) {
  for (let i = 0; i < hits.length; i++) {
    const src = hits[i]._source;
    if (src.dataset === dataset && src.question_id === questionId) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Average Precision：在每个正确命中的位置计算 Precision，取均值
 */
function averagePrecision(hits, dataset, questionId, k) {
  const topK = hits.slice(0, k);
  let relevantCount = 0;
  let sumPrecision = 0;

  for (let i = 0; i < topK.length; i++) {
    const src = topK[i]._source;
    if (src.dataset === dataset && src.question_id === questionId) {
      relevantCount++;
      sumPrecision += relevantCount / (i + 1);
    }
  }
  return relevantCount > 0 ? sumPrecision / relevantCount : 0;
}

// --- 3. 对全部问题执行查询并评测 ---
async function evaluate(queries, useCustomRanking) {
  let totalP = 0, totalRR = 0, totalAP = 0;

  for (const q of queries) {
    const body = buildSearchBody(q.question, "match", useCustomRanking, 0, K);

    const res = await fetch(`${ES_HOST}/${ES_INDEX}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error("ES 请求失败，请确保 ES 已启动且数据已导入");
    const json = await res.json();
    const hits = json.hits.hits;

    totalP  += precisionAtK(hits, q.dataset, q.question_id, K);
    totalRR += reciprocalRank(hits, q.dataset, q.question_id);
    totalAP += averagePrecision(hits, q.dataset, q.question_id, K);
  }

  const n = queries.length;
  return {
    precision: totalP / n,
    mrr: totalRR / n,
    map: totalAP / n,
  };
}

// --- 4. 主程序 ---
async function run() {
  console.log("\n [模块3] 搜索引擎检索质量评测启动...\n");

  try {
    const queries = loadQueries();
    console.log(` 成功加载测试数据集，共 ${queries.length} 个测试查询 (Queries)。`);
    console.log(` 评测维度：Top ${K} 条结果中，属于正确问题的检索准确率。\n`);

    // 测试 1: 纯 BM25
    console.log("正在运行 Baseline 测试 (纯文本匹配 BM25)...");
    const baseline = await evaluate(queries, false);

    // 测试 2: 综合排序
    console.log("正在运行 综合排序 测试 (Function Score 加权)...\n");
    const custom = await evaluate(queries, true);

    // 打印报告
    const fmt = (v) => v.toFixed(4);
    const pct = (a, b) => b > 0 ? ((a - b) / b * 100).toFixed(2) : 'N/A';

    console.log("=".repeat(60));
    console.log("  最终评测报告");
    console.log("=".repeat(60));
    console.log(`  ${"指标".padEnd(18)}  ${"Baseline (BM25)".padEnd(18)}${"综合排序".padEnd(18)}${"变化"}`);
    console.log("-".repeat(60));
    console.log(`  Precision@${K}        ${fmt(baseline.precision).padEnd(18)}${fmt(custom.precision).padEnd(18)}${pct(custom.precision, baseline.precision)}%`);
    console.log(`  MRR                 ${fmt(baseline.mrr).padEnd(18)}${fmt(custom.mrr).padEnd(18)}${pct(custom.mrr, baseline.mrr)}%`);
    console.log(`  MAP@${K}              ${fmt(baseline.map).padEnd(18)}${fmt(custom.map).padEnd(18)}${pct(custom.map, baseline.map)}%`);
    console.log("=".repeat(60));

    console.log("\n指标说明：");
    console.log("  Precision@K — Top K 结果中属于查询问题的比例（越高越好）");
    console.log("  MRR        — 首条正确结果的排名倒数（越高越好）");
    console.log("  MAP@K      — 各正确命中位置处精度的均值（越高越好）");
    console.log("");

  } catch (err) {
    console.error(" 评测过程中发生错误:", err.message);
  }
}

run();

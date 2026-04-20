// ==========================================
// EduSearch - 模块 3: 排序算法自动化评测脚本
// ==========================================

const fs = require('fs');
const path = require('path');
const { buildSearchBody } = require('../backend/esQuery');

const ES_HOST = 'http://localhost:9200';
const ES_INDEX = 'course_qa';
const DATA_PATH = path.join(__dirname, '../data/course_qa.json');

const LOGIC_WORDS = [
  "因为", "所以", "导致", "因此", "由于",
  "相比", "但是", "不同于", "然而", "反之",
  "比如", "例如", "包括", "如",
  "首先", "其次", "一方面", "另一方面", "综上"
];

function loadGroundTruth() {
  const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
  const qaData = JSON.parse(rawData.replace(/^\uFEFF/, ""));
  const gt = {};
  for (const category in qaData) {
    qaData[category].forEach(qObj => {
      const qText = qObj.question;
      gt[qText] = { idealRelevances: [] };
      qObj.answers.forEach(aObj => { gt[qText][aObj.answer] = aObj.answer_quality; });
      gt[qText].idealRelevances = qObj.answers.map(a => a.answer_quality).sort((a, b) => b - a);
    });
  }
  return gt;
}

function calculateDCG(relevances, k) {
  let dcg = 0;
  for (let i = 0; i < Math.min(relevances.length, k); i++) {
    dcg += (Math.pow(2, relevances[i]) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

function calculateNDCG(retrievedRelevances, idealRelevances, k = 10) {
  const idcg = calculateDCG(idealRelevances, k);
  if (idcg === 0) return 0;
  return calculateDCG(retrievedRelevances, k) / idcg;
}

function computeCustomScore(answerText, bm25NormScore) {
  const f1 = bm25NormScore;
  const f2 = Math.min(answerText.length / 150, 1);
  const textNoPunct = answerText.replace(/[。，！？；、“”‘’（）\s]/g, "");
  const f3 = Math.min(new Set(textNoPunct.split('')).size / 80, 1);
  let logicCount = 0;
  for (const word of LOGIC_WORDS) {
    if (answerText.includes(word)) logicCount++;
  }
  const f4 = Math.min(logicCount / 3, 1);
  return (0.55 * f1 + 0.15 * f2 + 0.15 * f3 + 0.15 * f4) * 9;
}

async function evaluateRanking(gtMap, useTextFeatures) {
  let totalNDCG = 0;
  const queries = Object.keys(gtMap);

  for (const query of queries) {
    // 🚨 修复Bug：去掉了导致 size 变为 0 的 false 参数
    const body = buildSearchBody(query, "match", 0, 20); 
    
    const res = await fetch(`${ES_HOST}/${ES_INDEX}/_search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const json = await res.json();
    let hits = json.hits.hits;

    if (useTextFeatures && hits.length > 0) {
      const maxScore = Math.max(...hits.map(h => h._score));
      const minScore = Math.min(...hits.map(h => h._score));
      hits = hits.map(hit => {
        const bm25Norm = (maxScore === minScore) ? 1 : (hit._score - minScore) / (maxScore - minScore);
        return { answer: hit._source.answer, score: computeCustomScore(hit._source.answer, bm25Norm) };
      });
      hits.sort((a, b) => b.score - a.score);
    } else {
      hits = hits.map(hit => ({ answer: hit._source.answer, score: hit._score }));
    }

    const retrievedRelevances = hits.slice(0, 10).map(h => gtMap[query][h.answer] || 0);
    totalNDCG += calculateNDCG(retrievedRelevances, gtMap[query].idealRelevances, 10);
  }
  return totalNDCG / queries.length;
}

async function run() {
  console.log("\n🚀 [模块3] 无监督多维文本特征重排序算法评测启动...\n");
  const gtMap = loadGroundTruth();
  
  console.log("⏳ 正在运行 Baseline 测试 (纯文本BM25匹配)...");
  const baselineNDCG = await evaluateRanking(gtMap, false);
  
  console.log("⏳ 正在运行 综合排序 测试 (基于 4 维底层文本特征)...");
  const customNDCG = await evaluateRanking(gtMap, true);
  
  const improvement = ((customNDCG - baselineNDCG) / baselineNDCG * 100).toFixed(2);
  
  console.log("\n============================================");
  console.log("📊 最终评测报告 (Metric: NDCG@10)");
  console.log("============================================");
  console.log(`📉 Baseline (纯 ES BM25匹配): \x1b[33m${baselineNDCG.toFixed(4)}\x1b[0m`);
  console.log(`📈 多维特征无监督重排: \x1b[32m${customNDCG.toFixed(4)}\x1b[0m`);
  console.log("--------------------------------------------");
  console.log(`🔥 算法提升幅度: \x1b[31;1m+${improvement}%\x1b[0m`);
  console.log("============================================\n");
}

run();
// ==========================================
// EduSearch - 模块 3: 排序算法评测脚本
// 核心指标: NDCG@10 (归一化折损累计增益)
// ==========================================

const fs = require('fs');
const path = require('path');
const { buildSearchBody } = require('../backend/esQuery');

const ES_HOST = 'http://localhost:9200';
const ES_INDEX = 'course_qa';
const DATA_PATH = path.join(__dirname, '../data/course_qa.json');

// --- 1. 数据准备：构建真实质量分字典 (Ground Truth) ---
function loadGroundTruth() {
  const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
  const qaData = JSON.parse(rawData.replace(/^\uFEFF/, ""));
  const gt = {};

  for (const category in qaData) {
    qaData[category].forEach(qObj => {
      const qText = qObj.question;
      gt[qText] = { idealRelevances: [] };
      
      qObj.answers.forEach(aObj => {
        // 记录：这个问题下，某个具体回答的真实质量分
        gt[qText][aObj.answer] = aObj.answer_quality;
      });
      
      // 算出该问题的“完美排序分数列表” (9, 8, 7...)，用于计算理想DCG
      gt[qText].idealRelevances = qObj.answers
        .map(a => a.answer_quality)
        .sort((a, b) => b - a);
    });
  }
  return gt;
}

// --- 2. 算法核心：计算 NDCG ---
// DCG公式: sum( (2^rel - 1) / log2(rank + 1) )
function calculateDCG(relevances, k) {
  let dcg = 0;
  for (let i = 0; i < Math.min(relevances.length, k); i++) {
    const rel = relevances[i];
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2); // i+2 因为索引从0开始，rank从1开始
  }
  return dcg;
}

function calculateNDCG(retrievedRelevances, idealRelevances, k = 10) {
  const idcg = calculateDCG(idealRelevances, k);
  if (idcg === 0) return 0;
  const dcg = calculateDCG(retrievedRelevances, k);
  return dcg / idcg;
}

// --- 3. 执行 ES 查询测试 ---
async function evaluateRanking(gtMap, useCustomRanking) {
  let totalNDCG = 0;
  const queries = Object.keys(gtMap);

  for (const query of queries) {
    // 构造请求体：直接查 ES 底层，绕过后端分组逻辑，纯粹评测 ES 排序能力
    const body = buildSearchBody(query, "match", useCustomRanking, 0, 10);
    
    const res = await fetch(`${ES_HOST}/${ES_INDEX}/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    if (!res.ok) throw new Error("ES 请求失败，请确保 ES 已启动且数据已导入");
    const json = await res.json();
    
    // 提取 ES 排好序的回答内容
    const retrievedAnswers = json.hits.hits.map(hit => hit._source.answer);
    
    // 将返回的回答转换为真实质量分（如果搜出了别的问题的回答，算作 0 分）
    const retrievedRelevances = retrievedAnswers.map(ans => gtMap[query][ans] || 0);
    
    // 计算当前查询的 NDCG@10
    const ndcg = calculateNDCG(retrievedRelevances, gtMap[query].idealRelevances, 10);
    totalNDCG += ndcg;
  }

  return totalNDCG / queries.length; // 返回平均 NDCG
}

// --- 4. 主程序运行 ---
async function run() {
  console.log("\n [模块3] 搜索引擎排序算法质量评测启动...\n");
  
  try {
    const gtMap = loadGroundTruth();
    console.log(` 成功加载测试数据集，共 ${Object.keys(gtMap).length} 个测试查询 (Queries)。`);
    
    // 测试 1: 原生 BM25 文本匹配
    console.log("\n⏳ 正在运行 Baseline 测试 (纯文本匹配 BM25)...");
    const baselineNDCG = await evaluateRanking(gtMap, false);
    
    // 测试 2: 综合质量排序算法
    console.log("⏳ 正在运行 综合排序 测试 (Function Score 加权)...");
    const customNDCG = await evaluateRanking(gtMap, true);
    
    // --- 打印报告 ---
    const improvement = ((customNDCG - baselineNDCG) / baselineNDCG * 100).toFixed(2);
    
    console.log("\n============================================");
    console.log(" 最终评测报告 (Metric: NDCG@10)");
    console.log("============================================");
    console.log(` Baseline (纯文本匹配): \x1b[33m${baselineNDCG.toFixed(4)}\x1b[0m`);
    console.log(` 综合排序 (质量加权算法): \x1b[32m${customNDCG.toFixed(4)}\x1b[0m`);
    console.log("--------------------------------------------");
    console.log(` 算法提升幅度: \x1b[31;1m+${improvement}%\x1b[0m`);
    console.log("============================================\n");
    
    if(improvement > 20) {
      console.log(" 结论：将 boost_mode 设为 multiply 后，质量极高的答案获得了提升，匹配了用户的搜索意图。");
    }

  } catch (err) {
    console.error(" 评测过程中发生错误:", err.message);
  }
}

run();
/**
 * ES 查询构建器
 *
 * 根据前端传入的 logic / use_custom_ranking 参数，
 * 生成对应的 Elasticsearch Query DSL，并在 JS 端执行无监督特征重排。
 */

const ES_HOST = process.env.ES_HOST || "http://localhost:9200";
const ES_INDEX = process.env.ES_INDEX || "course_qa";

/* ---------- 无监督多维特征打分算法 (新增) ---------- */

const LOGIC_WORDS = [
  "因为", "所以", "导致", "因此", "由于",
  "相比", "但是", "不同于", "然而", "反之",
  "比如", "例如", "包括", "如",
  "首先", "其次", "一方面", "另一方面", "综上"
];


function computeCustomScore(answerText, bm25NormScore) {
  // F1: ES 文本相关性 (55%)
  const f1 = bm25NormScore;
  // F2: 回答总长度 (15%)
  const f2 = Math.min(answerText.length / 150, 1);
  // F3: 词汇丰富度 (15%)
  const textNoPunct = answerText.replace(/[。，！？；、“”‘’（）\s]/g, "");
  const f3 = Math.min(new Set(textNoPunct.split('')).size / 80, 1);
  // F4: 逻辑论证深度 (15%)
  let logicCount = 0;
  for (const word of LOGIC_WORDS) {
    if (answerText.includes(word)) logicCount++;
  }
  const f4 = Math.min(logicCount / 3, 1);

  return (0.55 * f1 + 0.15 * f2 + 0.15 * f3 + 0.15 * f4) * 9;
}

/* ---------- 查询体构建 ---------- */

/**
 * 构建基础查询（不含排序加权）
 *
 * @param {string} keyword  搜索关键词
 * @param {"match"|"and"|"or"} logic  逻辑模式
 * @returns {object} ES query DSL 片段
 */
function buildBaseQuery(keyword, logic) {
  switch (logic) {
    case "and":
      return {
        multi_match: { query: keyword, fields: ["question", "answer"], operator: "and" },
      };
    case "or":
      return {
        bool: {
          should: [{ match: { question: keyword } }, { match: { answer: keyword } }],
          minimum_should_match: 1,
        },
      };
    case "match":
    default:
      return {
        multi_match: { query: keyword, fields: ["question^2", "answer"] },
      };
  }
}

/**
 * 构建完整查询体
 *
 * 算法改进说明：因为我们要使用复杂的 JS 文本特征提取，ES 的 function_score 无法实现。
 * 所以这里统一向 ES 请求纯净的 BaseQuery，打分重排逻辑后置到 search 函数中处理。
 *
 * @param {string}  keyword
 * @param {string}  logic
 * @param {boolean} useCustomRanking (已移至 search 拦截处理，保留参数签名以兼容原代码)
 * @param {number}  from   分页偏移
 * @param {number}  size   每页条数
 * @returns {object} 完整的 ES 请求体
 */
function buildSearchBody(keyword, logic, useCustomRanking, from = 0, size = 100) {
  const query = buildBaseQuery(keyword, logic);

  return {
    from,
    size,
    query, // 统一返回纯文本检索，去掉作弊的 function_score
    _source: [
      "doc_id",
      "dataset",
      "question_id",
      "question",
      "answer_quality",
      "answer",
    ],
  };
}

/* ---------- ES 请求封装 ---------- */

/**
 * 向 ES 发送搜索请求并返回原始响应 JSON
 */
async function executeSearch(body) {
  const url = `${ES_HOST}/${ES_INDEX}/_search`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ES 请求失败 (${res.status}): ${text}`);
  }

  return res.json();
}

/* ---------- 结果聚合：扁平文档 → 按问题分组 ---------- */

/**
 * 将 ES 返回的扁平文档按 (dataset, question_id) 分组，
 * 转换成前端期望的结构。
 */
function aggregateHits(esHits) {
  const groups = new Map();

  for (const hit of esHits) {
    const src = hit._source;
    const key = `${src.dataset}__${src.question_id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        course_name: src.dataset,
        _score: hit._score,
        question: src.question,
        answers: [],
      });
    }

    const group = groups.get(key);

    if (hit._score > group._score) {
      group._score = hit._score;
    }

    group.answers.push({
      answer_quality: src.answer_quality, // 保留前端展示用的标签
      answer: src.answer,
      _calc_score: hit._score // 【核心修改】：记录传入的计算分数，用于替代原先按 answer_quality 排序
    });
  }

  const results = [];
  for (const group of groups.values()) {
    // 【核心修改】：抛弃看着答案打分的行为，改为根据我们算出来的 _calc_score 降序
    group.answers.sort((a, b) => b._calc_score - a._calc_score);

    const best = group.answers[0];
    group.best_answer = {
      quality: best.answer_quality,
      content: best.answer,
    };

    group._score = parseFloat(group._score.toFixed(2));
    group.showMore = false;
    results.push(group);
  }

  results.sort((a, b) => b._score - a._score);

  return results;
}

/* ---------- 对外主函数 ---------- */

/**
 * 执行搜索并返回前端可用的格式化结果
 *
 * @returns {{ hits: Array, took: string }}
 */
async function search({ keyword, logic, useCustomRanking, from, size }) {
  const body = buildSearchBody(keyword, logic, useCustomRanking, from, size);
  const esResponse = await executeSearch(body);

  let hits = esResponse.hits.hits;

  // 【核心机制接入：无监督重排序 Re-ranking】
  if (useCustomRanking && hits.length > 0) {
    const maxScore = Math.max(...hits.map(h => h._score));
    const minScore = Math.min(...hits.map(h => h._score));

    hits.forEach(hit => {
      // BM25 组内归一化
      const bm25Norm = (maxScore === minScore) ? 1 : (hit._score - minScore) / (maxScore - minScore);
      // 计算多维特征综合分数，并覆盖原本单纯的文本 BM25 分数
      hit._score = computeCustomScore(hit._source.answer, bm25Norm);
    });
  }

  const aggregatedHits = aggregateHits(hits);
  const took = (esResponse.took / 1000).toFixed(2); // ms → s

  return { hits: aggregatedHits, took };
}

module.exports = { search, buildSearchBody, aggregateHits };
/**
 * ES 查询构建器
 *
 * 根据前端传入的 logic / use_custom_ranking 参数，
 * 生成对应的 Elasticsearch Query DSL。
 */

const ES_HOST = process.env.ES_HOST || "http://localhost:9200";
const ES_INDEX = process.env.ES_INDEX || "course_qa";

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
    // AND: 结果必须同时包含所有关键词
    case "and":
      return {
        multi_match: {
          query: keyword,
          fields: ["question", "answer"],
          operator: "and",
        },
      };

    // OR: 结果包含任意一个关键词即可
    case "or":
      return {
        bool: {
          should: [
            { match: { question: keyword } },
            { match: { answer: keyword } },
          ],
          minimum_should_match: 1,
        },
      };

    // match（默认）: 由 ES 按相关性评分
    case "match":
    default:
      return {
        multi_match: {
          query: keyword,
          fields: ["question^2", "answer"],
        },
      };
  }
}

/**
 * 构建完整查询体（含可选的综合排序）
 *
 * 当 useCustomRanking=true 时，使用 function_score 将文本相关性得分
 * 与 answer_quality 字段加权叠加，实现"高质量回答排在前面"的效果。
 *
 * 公式: final_score = text_score + log1p(factor * answer_quality)
 *
 * @param {string}  keyword
 * @param {string}  logic
 * @param {boolean} useCustomRanking
 * @param {number}  from   分页偏移
 * @param {number}  size   每页条数
 * @returns {object} 完整的 ES 请求体
 */
function buildSearchBody(keyword, logic, useCustomRanking, from = 0, size = 100, exclude = "") {
  let baseQuery = buildBaseQuery(keyword, logic);

  // NOT 排除逻辑：包含 keyword 但排除 exclude 中的词
  if (exclude && exclude.trim()) {
    baseQuery = {
      bool: {
        must: [baseQuery],
        must_not: [
          { multi_match: { query: exclude.trim(), fields: ["question", "answer"] } },
        ],
      },
    };
  }

  const query = useCustomRanking
    ? {
        function_score: {
          query: baseQuery,
          functions: [
            {
              field_value_factor: {
                field: "answer_quality",
                modifier: "log1p",
                factor: 2,
              },
            },
          ],
          boost_mode: "multiply",
        },
      }
    : baseQuery;

  return {
    from,
    size,
    query,
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

/* ---------- 自定义答案评分：不使用 answer_quality ---------- */

/**
 * 为同一问题组内的每个答案计算自定义评分（0-9 范围）。
 *
 * 三个维度:
 *   F1 — 回答长度（权重 0.50）: 更详尽的回答通常质量越高
 *   F2 — ES 文本相关性（权重 0.25）: answer 与 query 的 BM25 匹配度
 *   F3 — 词汇丰富度（权重 0.25）: 去重字符数越多，信息密度越大
 *
 * @param {Array}  answers  包含 _hit_score / answer 的答案数组
 */
function computeCustomScores(answers) {
  if (answers.length === 0) return;

  // ------- F2 归一化所需的组内极值 -------
  const hitScores = answers.map(a => a._hit_score);
  const maxS = Math.max(...hitScores);
  const minS = Math.min(...hitScores);
  const range = maxS - minS;

  for (const ans of answers) {
    // F1: 回答长度, 线性归一化，在 ~150 字符饱和
    const f1 = Math.min(ans.answer.length / 150, 1);

    // F2: ES 相关性分数, 组内 min-max 归一化
    const f2 = range > 0 ? (ans._hit_score - minS) / range : 0.5;

    // F3: 去标点后不重复字符数, 在 ~80 种字符饱和
    const cleaned = ans.answer.replace(/[\s，。？！、""''：；（）\d\w.,:;!?]/g, "");
    const uniqueChars = new Set(cleaned).size;
    const f3 = Math.min(uniqueChars / 80, 1);

    // 加权求和 → 映射到 0-9
    ans.custom_score = parseFloat(((0.50 * f1 + 0.25 * f2 + 0.25 * f3) * 9).toFixed(1));

    // 清除中间字段
    delete ans._hit_score;
  }
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

    // 保留组内最高 ES 分
    if (hit._score > group._score) {
      group._score = hit._score;
    }

    group.answers.push({
      answer_quality: src.answer_quality,
      answer: src.answer,
      _hit_score: hit._score, // 暂存，用于 computeCustomScores
    });
  }

  // 后处理：计算自定义评分 → 按自定义评分排序 → 选出最佳回答
  const results = [];
  for (const group of groups.values()) {
    computeCustomScores(group.answers);

    // 按自定义评分降序排列
    group.answers.sort((a, b) => b.custom_score - a.custom_score);

    const best = group.answers[0];
    group.best_answer = {
      quality: best.answer_quality,          // 标注 Q
      custom_score: best.custom_score,       // 自定义评分
      content: best.answer,
    };

    group._score = parseFloat(group._score.toFixed(2));
    group.showMore = false;
    results.push(group);
  }

  // 组间按 ES 相关性降序
  results.sort((a, b) => b._score - a._score);

  return results;
}

/* ---------- 对外主函数 ---------- */

/**
 * 执行搜索并返回前端可用的格式化结果
 *
 * @returns {{ hits: Array, took: string }}
 */
async function search({ keyword, logic, useCustomRanking, from, size, exclude }) {
  const body = buildSearchBody(keyword, logic, useCustomRanking, from, size, exclude);
  const esResponse = await executeSearch(body);

  const hits = aggregateHits(esResponse.hits.hits);
  const took = (esResponse.took / 1000).toFixed(2); // ms → s

  return { hits, took };
}

module.exports = { search, buildSearchBody, aggregateHits };

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
function buildSearchBody(keyword, logic, useCustomRanking, from = 0, size = 100) {
  const baseQuery = buildBaseQuery(keyword, logic);

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
          boost_mode: "sum",
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

/* ---------- 结果聚合：扁平文档 → 按问题分组 ---------- */

/**
 * 将 ES 返回的扁平文档按 (dataset, question_id) 分组，
 * 转换成前端期望的结构。
 *
 * 前端期望每条 hit:
 * {
 *   id, course_name, _score, question,
 *   best_answer: { quality, content },
 *   answers: [{ answer_quality, answer }],
 *   showMore: false
 * }
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

    // 保留组内最高分
    if (hit._score > group._score) {
      group._score = hit._score;
    }

    group.answers.push({
      answer_quality: src.answer_quality,
      answer: src.answer,
    });
  }

  // 后处理：排序 answers、选出 best_answer
  const results = [];
  for (const group of groups.values()) {
    // 按质量分降序
    group.answers.sort((a, b) => b.answer_quality - a.answer_quality);

    const best = group.answers[0];
    group.best_answer = {
      quality: best.answer_quality,
      content: best.answer,
    };

    group._score = parseFloat(group._score.toFixed(2));
    group.showMore = false;
    results.push(group);
  }

  // 按组最高分降序
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

  const hits = aggregateHits(esResponse.hits.hits);
  const took = (esResponse.took / 1000).toFixed(2); // ms → s

  return { hits, took };
}

module.exports = { search, buildSearchBody, aggregateHits };

# EduSearch 检索后端

基于 Node.js + Express 的搜索 API 服务，负责接收前端查询请求、构建 Elasticsearch DSL、返回格式化的检索结果。

## 环境要求

- **Node.js** 18+
- **Elasticsearch** 已启动并完成数据导入（参见 [scripts/README.md](../scripts/README.md)）

## 快速启动

```bash
# 1. 安装依赖
cd backend
npm install

# 2. 启动服务（默认端口 5000）
npm start
```

服务启动后会输出：

```
EduSearch 后端已启动: http://localhost:5000
ES 地址: http://localhost:9200
ES 索引: course_qa
```

## 环境变量

| 变量名     | 默认值                  | 说明               |
| ---------- | ----------------------- | ------------------ |
| `PORT`     | `5000`                  | 后端监听端口       |
| `ES_HOST`  | `http://localhost:9200` | Elasticsearch 地址 |
| `ES_INDEX` | `course_qa`             | ES 索引名称        |

示例：

```bash
ES_HOST=http://192.168.1.100:9200 ES_INDEX=course_qa_v2 npm start
```

## API 文档

### `POST /api/search`

搜索课程问答数据。

**请求体 (JSON):**

| 字段                 | 类型    | 必填 | 默认值    | 说明                                   |
| -------------------- | ------- | ---- | --------- | -------------------------------------- |
| `keyword`            | string  | ✅   | —         | 搜索关键词                             |
| `logic`              | string  | —    | `"match"` | 查询逻辑：`"match"` / `"and"` / `"or"` |
| `use_custom_ranking` | boolean | —    | `false`   | 是否启用综合排序（质量分加权）         |
| `page`               | number  | —    | `1`       | 页码（从 1 开始）                      |
| `page_size`          | number  | —    | `50`      | 每页条数（最大 200）                   |

**三种查询逻辑说明:**

| logic 值 | 行为                                | ES 实现                                   |
| -------- | ----------------------------------- | ----------------------------------------- |
| `match`  | 按相关度评分匹配，question 权重更高 | `multi_match` with `question^2`           |
| `and`    | 结果必须包含**所有**关键词          | `multi_match` + `operator: "and"`         |
| `or`     | 结果包含**任意**关键词即可          | `bool.should` + `minimum_should_match: 1` |

**综合排序算法:**

总分设定为 9 分，由以下 4 个正交（互不重叠）的特征加权组合而成：
| 特征代号 | 特征名称 | 权重 | 提取与计算方式 | 有效性 |
| :------- | :---------------------- | :------ | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | ES 文本相关性 | **55%** | `BM25 组内 Min-Max 归一化` | 确保算法优先关注不跑题，防止“废话长文”得高分。 |
| **F2** | 回答总长度 | 15% | `min(总字符数 / 150, 1)` | 技术解析通常需要展开论述，一句话抖机灵往往缺乏价值。 |
| **F3** | 词汇丰富度 | 15% | `min(去标点不重复字符数 / 80, 1)` | 高质量回答会引入多维度的概念，而凑字数的废话去重后字符数极低。 |
| **F4** | **逻辑论证深度 (创新)** | 15% | `min(命中的逻辑词数量 / 3, 1)` | 硬编码构建极轻量通用逻辑词表（如：因为、相比、比如等）。高质量技术解答必然包含推导、对比和举例，不依赖庞大专业词库即可精准预判其专业性。 |

**请求示例:**

```bash
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"keyword": "自然语言处理", "logic": "match", "use_custom_ranking": true}'
```

**响应体:**

```json
{
  "hits": [
    {
      "id": "自然语言处理课程知识问答__1",
      "course_name": "自然语言处理课程知识问答",
      "_score": 23.45,
      "question": "什么是自然语言处理？",
      "best_answer": {
        "quality": 9,
        "content": "自然语言处理是研究如何用计算方法对人类语言进行建模..."
      },
      "answers": [
        { "answer_quality": 9, "answer": "自然语言处理是研究如何..." },
        { "answer_quality": 8, "answer": "自然语言处理是面向人类..." },
        ...
      ],
      "showMore": false
    }
  ],
  "took": "0.02"
}
```

**错误响应:**

| 状态码 | 说明                                       |
| ------ | ------------------------------------------ |
| 400    | 参数校验失败（keyword 为空、logic 值非法） |
| 502    | Elasticsearch 不可达                       |

---

### `GET /api/health`

健康检查接口。

**响应示例:**

```json
{ "status": "ok", "es": "connected" }
```

或 ES 不可达时：

```json
{ "status": "degraded", "es": "unreachable" }
```

## 代码结构

```
backend/
├── server.js       # Express 入口：路由、CORS、输入校验
├── esQuery.js      # ES 查询构建器：DSL 生成、function_score 排序、结果聚合
├── package.json    # 依赖声明
└── README.md       # 本文件
```

### esQuery.js 核心逻辑

1. **`buildSearchBody()`** — 根据 logic 和 useCustomRanking 生成完整 ES 请求体
2. **`executeSearch()`** — 通过 fetch 调用 ES `_search` REST API
3. **`aggregateHits()`** — 将 ES 返回的扁平文档（每个 question-answer 对一条）按 `(dataset, question_id)` 分组，选出 best_answer，所有 answers 按质量降序排列
4. **`search()`** — 对外主函数，串联上述步骤

## 给其他模块同学的说明

### 给模块 3（排序与评测）

- 综合排序算法已在 `esQuery.js` 的 `buildSearchBody()` 中实现
- 当前公式：`final_score = text_relevance_score + log(1 + 2 × answer_quality)`
- 你可以修改 `function_score.functions` 中的参数来调优：
  - `factor`: 质量分的放大系数（当前为 2）
  - `modifier`: 缩放函数（当前为 `log1p`，可选 `sqrt`、`square`、`none` 等）
  - `boost_mode`: 组合方式（当前为 `sum`，可选 `multiply`、`replace` 等）
- 评测时可对比 `use_custom_ranking=true/false` 两组结果的排序差异

### 给模块 4（前端与汇报）

- 前端 `index.html` 中的 `mockSearch` 函数已替换为真实 API 调用
- API 地址: `POST http://localhost:5000/api/search`
- 返回结构与前端现有模板完全兼容，无需修改模板绑定
- 如果需要修改后端端口，改 `index.html` 中 `API_BASE` 常量即可

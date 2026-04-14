# EduSearch 排序与评测模块

基于 Elasticsearch 的 `function_score` 机制实现综合排序算法，并使用 **检索质量** 指标（Precision@K、MRR、MAP）对系统进行科学评测。

## 模块负责人

- 负责模块：3. 排序与评测

## 核心算法改进

默认文本检索仅基于 **BM25** 算法。我们在 `backend/esQuery.js` 中使用 `function_score` 将 `answer_quality` 作为排序加权因子：

```javascript
function_score: {
  field_value_factor: {
    field: "answer_quality",
    modifier: "log1p",
    factor: 2
  },
  boost_mode: "multiply"
}
```

`boost_mode: "multiply"` 使文本相关性成为基数，答案质量分成为倍率放大器。

## 评测思路

> **为什么不用 NDCG？**
>
> 系统排序因子中已经包含 `answer_quality` 字段。如果用同一个字段构建 Ground Truth 来计算 NDCG，排序算法天然就会获得接近 1.0 的得分——这是 **循环论证**，无法反映真实检索能力。

本项目转而评测 **检索质量**：以每个问题作为查询词，测量 ES 是否能返回 **属于该问题的回答**（而非其他问题的回答）。

### 评测指标

| 指标 | 含义 |
|---|---|
| **Precision@K** | Top K 条结果中，属于该查询问题的比例 |
| **MRR** (Mean Reciprocal Rank) | 第一条正确结果出现位置的倒数 |
| **MAP@K** (Mean Average Precision) | 每个正确命中位置处精度的均值 |

### 执行流程

1. **加载测试查询**：从 `course_qa.json` 提取所有问题，记录 `dataset` 和 `question_id`。
2. **Baseline 测试**：关闭综合排序（纯 BM25），对所有问题发起检索。
3. **综合排序测试**：开启 Function Score 加权，再次检索。
4. **计算指标**：对 Top K 结果，判断 `dataset` 和 `question_id` 是否匹配来确定相关性。
5. **输出对比报告**：汇总平均值，展示两种策略的差异。

## 快速运行

```bash
node evaluation/evaluator.js
```

> 请确保 Elasticsearch 已运行且数据已导入。

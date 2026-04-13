# EduSearch 排序与评测模块

基于 Elasticsearch 的 `function_score` 机制实现综合排序算法，并使用业界标准的信息检索指标（NDCG）对系统排序质量进行科学评测。

## 模块负责人

- 负责模块：3. 排序与评测

## 核心算法改进

默认的文本检索仅基于 **BM25** 算法，这导致“虽然相关但毫无营养”的低质量回答可能由于长度短、词频高而排在前面。我们在 `backend/esQuery.js` 中设计并优化了综合排序算法：

```javascript
function_score: {
  field_value_factor: {
    field: "answer_quality",
    modifier: "log1p", // 对数平滑，防止极端值
    factor: 2
  },
  boost_mode: "multiply" // 核心改进
}
```

**改进亮点**：将 `boost_mode` 设置为 `multiply`（乘法）而非简单的相加。这使得文本相关性成为基数，而答案的真实质量分（`answer_quality`）成为了**倍率放大器**。高质答案得分倍增，低质答案失去放大效应，从而显著改善了最终的 Top-K 结果。

## 评测指标与代码执行流程

本项目采用 **NDCG@10 (Normalized Discounted Cumulative Gain)** 作为核心评测指标。评测脚本 `evaluator.js` 的全自动化执行流程如下：

1. **构建真值字典 (Ground Truth)**：脚本首先读取原始数据 `course_qa.json`，将 40 个测试问题及其对应的所有回答质量分（0-9分）加载到内存中，并计算出每个问题的理想完美排序（IDCG）。
2. **执行 Baseline 查询**：关闭综合排序机制（纯文本 BM25 匹配），通过 HTTP 向 ES 发起全部 40 个问题的检索请求。
3. **执行优化算法查询**：开启综合排序（Function Score 加权），再次向 ES 发起检索请求。
4. **计算 NDCG 分数**：提取 ES 每次返回的 Top 10 回答，通过映射字典查找其真实的客观质量分，计算当前排序的 DCG，并除以 IDCG 得到 NDCG 分数。
5. **输出对比报告**：汇总求平均值，直观展示算法优化带来的提升。

## 快速运行评测脚本

确保 Elasticsearch 已运行，且测试数据已成功导入。在项目根目录执行以下命令：

```bash
node evaluation/evaluator.js
```

## 最终实验结果 (Results)

基于 40 个测试查询（Queries），系统自动评测结果如下：

| 排序策略     | 核心机制                  | 平均 NDCG@10    |
| ------------ | ------------------------- | --------------- |
| **Baseline** | 纯文本匹配 (BM25)         | `0.3925`        |
| **综合排序** | BM25 _ log1p(2 _ Quality) | `0.9992`        |
| **提升幅度** |                           | **🔥 +154.55%** |

**结论：**
实验数据证明，将 `boost_mode` 设为 `multiply` 后，质量极高的答案获得了提升，成功过滤了大量命中关键词但缺乏实质内容的低质答案，匹配了用户的搜索意图。

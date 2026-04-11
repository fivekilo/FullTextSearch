# EduSearch 课程问答检索前端说明

本项目前端作为“课程技术问答全文本搜索引擎”的用户交互界面，主要满足以下项目需求：
- 提供直观友好的搜索交互界面。
- 支持多种逻辑运算查询选择（Match, AND, OR）。
- 提供综合排序算法选项（启用质量分加权排序算法）。
- 展示搜索结果、Elasticsearch 相关性得分以及答案质量评价。

## 技术栈选型

为了保持项目的轻量级，并专注于后端的全文本搜索引擎（ES）构建，前端采用了纯 CDN 引入的无构建 (No-Build) 方式：
- **[Vue 3 (Global Build)](https://vuejs.org/)**：用于数据绑定、DOM 渲染控制及逻辑映射。
- **[Tailwind CSS (CDN)](https://tailwindcss.com/)**：用于快速、现代化的响应式页面 UI 布局。

## 运行方式

无需任何 `npm install` 操作或构建步骤。
直接在文件管理器中双击 `index.html` 文件，使用任意现代浏览器（如 Chrome, Edge, Firefox）打开即可查看并交互。

## 目录结构

```text
frontend/
  ├── index.html   # 前端主页面，包含 HTML 结构、Tailwind 样式类及 Vue 交互脚本
  └── README.md    # 前端说明文档 (当前文件)
```

## 功能特性对照项目要求

1. **支持多种逻辑运算查询**
   在搜索框下方提供了 `相关度匹配 (Match)`、`包含所有 (AND)`、`包含任意 (OR)` 等选项。前端会将用户的选择作为查询参数（`logicType`）透传给后端 API，用于控制 ES 查询语句（如 `match`, `bool must`, `bool should` 等）。

2. **设计综合排序算法与质量评价**
   提供了一个“启用综合排序算法(质量分加权)”复选框。勾选后，通知后端使用基于 `answer_quality` 与文本相关性综合计算的 Score。前端并在结果中展示该条结果的具体得分为 `_score`，并在回答上动态展示质量角标（如“高质量回答”、“普通回答”）。

3. **数据结构展现**
   兼容原始 `course_qa.json` 结构，支持单个问题包含**多个备选回答**的展示，支持一键折叠/展开所有回答记录，方便对同一个检索结果的不同回答质量进行对比评价。

## 后续对接后端指南 (TODO)

当前 `index.html` 使用了前端模拟数据（`mockSearch` 函数）来演示界面交互。当后端 Elasticsearch API 开发完毕后，需要进行以下简单替换：

1. 在 HTML 中找到 `script` 标签内的 `mockSearch` 逻辑。
2. 将其替换为原生的 `fetch` 或者引入 `axios` 发起真实的 HTTP 请求：
   ```javascript
   const handleSearch = async () => {
       hasSearched.value = true;
       try {
           const response = await fetch(`http://localhost:5000/api/search`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                   keyword: searchQuery.value,
                   logic: logicType.value,
                   use_custom_ranking: useCustomRanking.value
               })
           });
           const data = await response.json();
           results.value = data.hits; // 替换为真实的后端返回结构
           searchTime.value = data.took;
       } catch (error) {
           console.error("搜索请求失败", error);
       }
   };
   ```
3. 根据后端接口实际返回的 JSON 结构，微调页面模板 ( `<template>` ) 中绑定的字段名称即可。

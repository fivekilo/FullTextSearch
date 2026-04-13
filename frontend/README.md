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

## 运行方式（前后端联调测试）

前端本身不需要 `npm install`。您可以直接用现代浏览器打开 `index.html`。但要获得真实搜索数据，需启动整套服务（含 ES 数据与后端 API）。

1. 确保您的电脑上已经启动好了本地的 **Elasticsearch** (运行在 `http://localhost:9200`)。
2. 在项目根目录执行 `npm install --prefix backend` 初始化后端环境。
3. 执行 `npm run import-data` 导入测试数据集至 ES 索引。
4. 执行 `npm start` 启动本地提供支持查询服务的 Node.js API (监听 `http://localhost:5000`)。
5. 双击 `index.html` 打开浏览器，输入关键词尝试搜索（如“自然语言”、“分类”等）。

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

*(注：该项目现已打通真实后端。调用本地提供的 `http://localhost:5000/api/search` Fetch 请求即可进行真正的 Elasticsearch 检索。)* 

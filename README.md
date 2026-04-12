# EduSearch — 课程技术问答全文本搜索引擎

## 项目简介

基于 Elasticsearch 的课程问答全文本搜索引擎，支持多种逻辑查询（Match / AND / OR）、综合排序算法（质量分加权）以及结果质量评价。

## 项目需求

- 将各组收集的课程技术问答整合项目数据后写入 ES
- 界面要求（前端设计）
- 支持多种逻辑运算查询
- 设计综合排序算法
- 根据收集的项目数据对排序进行质量评价

## 技术架构

```
┌────────────┐     POST /api/search     ┌────────────┐     _search API     ┌───────────────┐
│  前端 Vue3  │ ──────────────────────▶  │  Express   │ ─────────────────▶  │ Elasticsearch │
│  index.html │ ◀──────────────────────  │  后端:5000  │ ◀─────────────────  │    :9200      │
└────────────┘      JSON Response       └────────────┘    JSON Response    └───────────────┘
```

| 层级 | 技术 | 目录 |
|------|------|------|
| 数据导入 | Node.js 脚本 | `scripts/` |
| 检索后端 | Express + fetch | `backend/` |
| 前端界面 | Vue 3 + Tailwind CSS (CDN) | `frontend/` |
| 搜索引擎 | Elasticsearch | 外部服务 |

## 快速开始

### 1. 启动 Elasticsearch

确保 ES 运行在 `http://localhost:9200`。

### 2. 导入数据

```bash
node scripts/import_to_es.js --force-recreate
```

详见 [scripts/README.md](scripts/README.md)

### 3. 启动后端

```bash
cd backend
npm install
npm start
```

后端监听 `http://localhost:5000`，详见 [backend/README.md](backend/README.md)

### 4. 打开前端

浏览器直接打开 `frontend/index.html` 即可使用。

详见 [frontend/README.md](frontend/README.md)

## 目录结构

```
FullTextSearch/
├── README.md               # 项目总览（本文件）
├── data/
│   └── course_qa.json      # 课程问答数据（含多质量等级回答）
├── scripts/
│   ├── import_to_es.js     # ES 数据导入脚本
│   └── README.md           # 导入脚本说明
├── backend/
│   ├── server.js           # Express 入口：路由、CORS、校验
│   ├── esQuery.js          # ES 查询构建器：DSL 生成、排序、结果聚合
│   ├── package.json        # 后端依赖
│   └── README.md           # 后端 API 文档
└── frontend/
    ├── index.html          # 搜索界面（Vue 3 + Tailwind CSS）
    └── README.md           # 前端说明
```

## 模块分工

| 模块 | 内容 | 状态 |
|------|------|------|
| 1. 数据整理 + ES 导入 | 统一数据格式、设计 mapping、写导入脚本 | ✅ 已完成 |
| 2. 检索后端 | 搜索接口、布尔查询、分页，与 ES 联调 | ✅ 已完成 |
| 3. 排序与评测 | 设计综合排序、效果评估、整理实验结果 | 进行中 |
| 4. 前端与汇报 | 搜索页面、结果展示、README、PPT、演示 | ✅ 已完成 |

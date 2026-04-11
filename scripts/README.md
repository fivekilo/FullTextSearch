# ES 导入说明

## 环境

- Node.js 18+
- Elasticsearch 默认运行在 `http://localhost:9200`

## 导入

在项目根目录执行：

```powershell
node scripts/import_to_es.js --force-recreate
```

默认会：

- 读取 `data/course_qa.json`
- 创建索引 `course_qa`
- 导入全部问答数据

## 常用参数

指定 ES 地址：

```powershell
node scripts/import_to_es.js --es-host http://127.0.0.1:9200
```

指定索引名：

```powershell
node scripts/import_to_es.js --index course_qa_v1
```

指定数据文件：

```powershell
node scripts/import_to_es.js --data-file data/course_qa.json
```

## 验证

查看是否导入成功：

```powershell
curl http://localhost:9200/course_qa/_count
```

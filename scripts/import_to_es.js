#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  },
  mappings: {
    properties: {
      doc_id: { type: "keyword" },
      dataset: { type: "keyword" },
      question_id: { type: "integer" },
      question: {
        type: "text",
        fields: {
          raw: { type: "keyword", ignore_above: 512 },
        },
      },
      answer_quality: { type: "integer" },
      answer: {
        type: "text",
        fields: {
          raw: { type: "keyword", ignore_above: 512 },
        },
      },
    },
  },
};

function printHelp() {
  console.log(`Usage:
  node scripts/import_to_es.js [options]

Options:
  --data-file <path>       Path to merged QA JSON file
  --es-host <url>          Elasticsearch host URL
  --index <name>           Target index name
  --force-recreate         Delete and recreate index before importing
  --help, -h               Show this help message
`);
}

function parseArgs(argv) {
  const args = {
    dataFile: "data/course_qa.json",
    esHost: "http://localhost:9200",
    index: "course_qa",
    forceRecreate: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--data-file") {
      args.dataFile = argv[++i];
    } else if (arg === "--es-host") {
      args.esHost = argv[++i];
    } else if (arg === "--index") {
      args.index = argv[++i];
    } else if (arg === "--force-recreate") {
      args.forceRecreate = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function requestText(method, url, payload, headers = {}) {
  const options = { method, headers: { ...headers } };

  if (payload !== undefined) {
    options.body = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!options.headers["Content-Type"]) {
      options.headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}\n${text}`);
  }

  return text;
}

function flattenDocuments(data) {
  const docs = [];

  for (const [datasetName, items] of Object.entries(data)) {
    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      const answers = Array.isArray(item.answers) ? item.answers : [];
      for (const answerObj of answers) {
        const docId = `${datasetName}__q${item.id}__a${answerObj.answer_quality}`;
        docs.push({
          doc_id: docId,
          dataset: datasetName,
          question_id: item.id,
          question: item.question,
          answer_quality: answerObj.answer_quality,
          answer: answerObj.answer,
        });
      }
    }
  }

  return docs;
}

async function indexExists(esHost, indexName) {
  const response = await fetch(`${esHost}/${indexName}`, { method: "HEAD" });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} for ${esHost}/${indexName}\n${text}`);
  }
  return true;
}

async function createIndex(esHost, indexName, forceRecreate) {
  if (await indexExists(esHost, indexName)) {
    if (!forceRecreate) {
      console.log(`Index '${indexName}' already exists, skip creating it.`);
      return;
    }

    await requestText("DELETE", `${esHost}/${indexName}`);
    console.log(`Deleted existing index: ${indexName}`);
  }

  await requestText("PUT", `${esHost}/${indexName}`, DEFAULT_MAPPING);
  console.log(`Created index: ${indexName}`);
}

function buildBulkPayload(docs) {
  const lines = [];

  for (const doc of docs) {
    lines.push(JSON.stringify({ index: { _id: doc.doc_id } }));
    lines.push(JSON.stringify(doc));
  }

  return `${lines.join("\n")}\n`;
}

async function bulkImport(esHost, indexName, docs) {
  const text = await requestText(
    "POST",
    `${esHost}/${indexName}/_bulk`,
    buildBulkPayload(docs),
    { "Content-Type": "application/x-ndjson" }
  );

  const result = JSON.parse(text);
  if (result.errors) {
    const failed = [];
    for (const item of result.items || []) {
      const action = item.index || {};
      if (action.error) {
        failed.push(action);
      }
    }
    throw new Error(
      `Bulk import completed with errors: ${JSON.stringify(failed.slice(0, 5))}`
    );
  }

  console.log(`Imported ${docs.length} documents into index '${indexName}'.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = path.resolve(args.dataFile);

  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found: ${dataPath}`);
  }

  const raw = fs.readFileSync(dataPath, "utf8");
  const normalized = raw.replace(/^\uFEFF/, "");
  const data = JSON.parse(normalized);
  const docs = flattenDocuments(data);

  if (docs.length === 0) {
    throw new Error("No documents found to import.");
  }

  const esHost = args.esHost.replace(/\/$/, "");
  console.log(`Loaded ${docs.length} documents from ${dataPath}.`);

  await createIndex(esHost, args.index, args.forceRecreate);
  await bulkImport(esHost, args.index, docs);
  console.log("Done.");
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});

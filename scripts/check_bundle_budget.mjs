import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const KB = 1024;
const ASSETS_DIR = path.resolve(process.cwd(), "dist/assets");

const BUDGETS = {
  requiredChunks: [
    { label: "index chunk", pattern: /^index-.*\.js$/, maxGzipKB: 100 },
    { label: "vendor-editor chunk", pattern: /^vendor-editor-.*\.js$/, maxGzipKB: 130 },
    { label: "vendor-react chunk", pattern: /^vendor-react-.*\.js$/, maxGzipKB: 40 },
    { label: "vendor-motion chunk", pattern: /^vendor-motion-.*\.js$/, maxGzipKB: 48 },
    { label: "vendor-i18n chunk", pattern: /^vendor-i18n-.*\.js$/, maxGzipKB: 20 },
    { label: "vendor-icons chunk", pattern: /^vendor-icons-.*\.js$/, maxGzipKB: 8 },
    { label: "main css", pattern: /^index-.*\.css$/, maxGzipKB: 20 },
  ],
  perFile: {
    jsMaxGzipKB: 140,
    cssMaxGzipKB: 20,
  },
  totals: {
    jsTotalGzipKB: 415,
    cssTotalGzipKB: 25,
  },
};

function toKB(bytes) {
  return bytes / KB;
}

function fmtKB(bytes) {
  return `${toKB(bytes).toFixed(2)} KB`;
}

function fail(message) {
  console.error(`\n[BundleBudget] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(ASSETS_DIR)) {
  fail(`Missing assets directory: ${ASSETS_DIR}. Run "npm run build" first.`);
}

const files = fs
  .readdirSync(ASSETS_DIR)
  .filter((file) => file.endsWith(".js") || file.endsWith(".css"));

if (files.length === 0) {
  fail(`No JS/CSS assets found under ${ASSETS_DIR}.`);
}

const assets = files.map((name) => {
  const fullPath = path.join(ASSETS_DIR, name);
  const content = fs.readFileSync(fullPath);
  const gzipBytes = zlib.gzipSync(content).length;
  const type = name.endsWith(".js") ? "js" : "css";
  return { name, type, gzipBytes };
});

const violations = [];

for (const rule of BUDGETS.requiredChunks) {
  const matched = assets.find((asset) => rule.pattern.test(asset.name));
  if (!matched) {
    violations.push(
      `${rule.label}: expected chunk not found (pattern: ${rule.pattern})`
    );
    continue;
  }
  if (toKB(matched.gzipBytes) > rule.maxGzipKB) {
    violations.push(
      `${rule.label} exceeded: ${fmtKB(matched.gzipBytes)} > ${rule.maxGzipKB} KB (${matched.name})`
    );
  }
}

for (const asset of assets) {
  if (asset.type === "js" && toKB(asset.gzipBytes) > BUDGETS.perFile.jsMaxGzipKB) {
    violations.push(
      `Per-file JS budget exceeded: ${asset.name} (${fmtKB(asset.gzipBytes)}) > ${BUDGETS.perFile.jsMaxGzipKB} KB`
    );
  }
  if (asset.type === "css" && toKB(asset.gzipBytes) > BUDGETS.perFile.cssMaxGzipKB) {
    violations.push(
      `Per-file CSS budget exceeded: ${asset.name} (${fmtKB(asset.gzipBytes)}) > ${BUDGETS.perFile.cssMaxGzipKB} KB`
    );
  }
}

const jsTotal = assets
  .filter((asset) => asset.type === "js")
  .reduce((sum, asset) => sum + asset.gzipBytes, 0);
const cssTotal = assets
  .filter((asset) => asset.type === "css")
  .reduce((sum, asset) => sum + asset.gzipBytes, 0);

if (toKB(jsTotal) > BUDGETS.totals.jsTotalGzipKB) {
  violations.push(
    `Total JS budget exceeded: ${fmtKB(jsTotal)} > ${BUDGETS.totals.jsTotalGzipKB} KB`
  );
}
if (toKB(cssTotal) > BUDGETS.totals.cssTotalGzipKB) {
  violations.push(
    `Total CSS budget exceeded: ${fmtKB(cssTotal)} > ${BUDGETS.totals.cssTotalGzipKB} KB`
  );
}

const topAssets = [...assets]
  .sort((a, b) => b.gzipBytes - a.gzipBytes)
  .slice(0, 8);

console.log("[BundleBudget] Top gzip assets:");
for (const asset of topAssets) {
  console.log(`  - ${asset.name}: ${fmtKB(asset.gzipBytes)}`);
}
console.log(`[BundleBudget] JS total gzip: ${fmtKB(jsTotal)}`);
console.log(`[BundleBudget] CSS total gzip: ${fmtKB(cssTotal)}`);

if (violations.length > 0) {
  console.error("\n[BundleBudget] Budget violations:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("[BundleBudget] PASS");

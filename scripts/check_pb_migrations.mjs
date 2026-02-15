#!/usr/bin/env node
/* eslint-disable no-console */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = "backend/pb_migrations";

const ALLOWED_TYPES = new Set(["schema", "data", "backfill", "hotfix"]);
const ALLOWED_DOMAINS = new Set([
  "core",
  "velocity",
  "mcsm",
  "translate",
  "security",
  "ops",
]);

function run(cmd, { allowFail = false } = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (allowFail) {
      return "";
    }
    const stderr = err?.stderr ? String(err.stderr) : "";
    throw new Error(`Command failed: ${cmd}\n${stderr}`);
  }
}

function isAllZerosSha(sha) {
  const value = `${sha || ""}`.trim();
  return value.length === 40 && /^0+$/.test(value);
}

function parseNameStatus(output) {
  const lines = `${output || ""}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries = [];

  for (const line of lines) {
    // Examples:
    // A\tpath
    // M\tpath
    // R100\told\tnew
    const parts = line.split(/\s+/);
    const status = parts[0] || "";
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      entries.push({ status, oldPath: parts[1] || "", path: parts[2] || "" });
    } else {
      entries.push({ status, path: parts[1] || "" });
    }
  }

  return entries;
}

function validateMigrationFileName(filePath) {
  const base = path.basename(filePath);
  const match = base.match(
    /^(\d{10})_(schema|data|backfill|hotfix)_(core|velocity|mcsm|translate|security|ops)_([a-z0-9]+(?:_[a-z0-9]+)*)\.js$/
  );
  if (!match) {
    return {
      ok: false,
      reason:
        "filename must match <epoch>_<type>_<domain>_<slug>.js, e.g. 1765100120_schema_core_add_field_x.js",
    };
  }

  const type = match[2];
  const domain = match[3];
  if (!ALLOWED_TYPES.has(type)) {
    return { ok: false, reason: `invalid type: ${type}` };
  }
  if (!ALLOWED_DOMAINS.has(domain)) {
    return { ok: false, reason: `invalid domain: ${domain}` };
  }
  return { ok: true };
}

function findMigrateCall(content) {
  const match = content.match(/\bmigrate\s*\(/);
  if (!match) return null;
  return match.index ?? null;
}

function analyzeMigrateCallArgs(content, migrateIndex) {
  // Returns { argCount, firstCommaIndex, hasTwoArgs }
  const startParen = content.indexOf("(", migrateIndex);
  if (startParen === -1) {
    return { argCount: 0, firstCommaIndex: -1, hasTwoArgs: false };
  }

  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let argCount = 1;
  let firstCommaIndex = -1;

  let inString = null; // "'" | '"' | "`"
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = startParen; i < content.length; i += 1) {
    const ch = content[i];
    const next = i + 1 < content.length ? content[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        break;
      }
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (ch === "," && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
      argCount += 1;
      if (firstCommaIndex === -1) {
        firstCommaIndex = i;
      }
    }
  }

  return {
    argCount,
    firstCommaIndex,
    hasTwoArgs: argCount >= 2,
  };
}

function validateMigrationTemplate(filePath, content) {
  const lines = `${content || ""}`.split(/\r?\n/);
  const firstMeaningful = lines
    .slice(0, 25)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("///"));

  if (!firstMeaningful || !firstMeaningful.startsWith("/**")) {
    return {
      ok: false,
      reason:
        "missing header block comment (/** ... */) near top of file (required for new migrations)",
    };
  }

  const migrateIndex = findMigrateCall(content);
  if (migrateIndex === null) {
    return { ok: false, reason: "missing migrate(...) call" };
  }

  const analysis = analyzeMigrateCallArgs(content, migrateIndex);
  if (!analysis.hasTwoArgs) {
    return {
      ok: false,
      reason: "migrate(...) must provide both up and down functions (2 args)",
    };
  }

  const afterComma =
    analysis.firstCommaIndex >= 0
      ? content.slice(analysis.firstCommaIndex + 1, analysis.firstCommaIndex + 220)
      : "";
  if (!/\b(?:async\s*)?\(\s*app\s*\)\s*=>|\bfunction\b/.test(afterComma)) {
    return {
      ok: false,
      reason: "down migration must be a function (expected ', (app) => { ... }')",
    };
  }

  return { ok: true };
}

function main() {
  const baseSha = `${process.env.MIGRATION_CHECK_BASE_SHA || ""}`.trim();
  const headSha = `${process.env.MIGRATION_CHECK_HEAD_SHA || ""}`.trim();

  let diffOutput = "";
  if (baseSha && headSha && !isAllZerosSha(baseSha)) {
    diffOutput = run(
      `git diff --name-status ${baseSha}..${headSha} -- ${MIGRATIONS_DIR}`,
      { allowFail: true }
    );
  } else {
    // Fallback to working tree (useful for local development)
    const unstaged = run(`git diff --name-status HEAD -- ${MIGRATIONS_DIR}`, { allowFail: true });
    const staged = run(`git diff --name-status --cached -- ${MIGRATIONS_DIR}`, { allowFail: true });
    diffOutput = [unstaged, staged].filter(Boolean).join("\n");
  }

  const entries = parseNameStatus(diffOutput);
  if (entries.length === 0) {
    console.log("[check_pb_migrations] No migration changes detected.");
    return;
  }

  const forbidden = entries.filter((e) => !(e.status === "A"));
  if (forbidden.length > 0) {
    console.error("[check_pb_migrations] ERROR: Existing migrations must never be modified/renamed/deleted.");
    for (const e of forbidden) {
      if (e.oldPath) {
        console.error(`  - ${e.status} ${e.oldPath} -> ${e.path}`);
      } else {
        console.error(`  - ${e.status} ${e.path}`);
      }
    }
    process.exit(1);
  }

  const added = entries
    .filter((e) => e.status === "A")
    .map((e) => e.path)
    .filter((p) => p && p.startsWith(`${MIGRATIONS_DIR}/`));

  if (added.length === 0) {
    console.log("[check_pb_migrations] No new migration files detected.");
    return;
  }

  const nameErrors = [];
  const templateErrors = [];

  for (const filePath of added) {
    const nameCheck = validateMigrationFileName(filePath);
    if (!nameCheck.ok) {
      nameErrors.push({ filePath, reason: nameCheck.reason });
      continue;
    }

    const absPath = path.resolve(process.cwd(), filePath);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch (err) {
      templateErrors.push({ filePath, reason: `failed to read file: ${err?.message || err}` });
      continue;
    }

    const tplCheck = validateMigrationTemplate(filePath, content);
    if (!tplCheck.ok) {
      templateErrors.push({ filePath, reason: tplCheck.reason });
    }
  }

  if (nameErrors.length > 0 || templateErrors.length > 0) {
    console.error("[check_pb_migrations] ERROR: Migration governance checks failed.");
    if (nameErrors.length > 0) {
      console.error("\n[Filename] New migration filenames must follow: <epoch>_<type>_<domain>_<slug>.js");
      for (const e of nameErrors) {
        console.error(`  - ${e.filePath}: ${e.reason}`);
      }
    }
    if (templateErrors.length > 0) {
      console.error("\n[Template] New migrations must include header comment and migrate(up, down)");
      for (const e of templateErrors) {
        console.error(`  - ${e.filePath}: ${e.reason}`);
      }
    }
    process.exit(1);
  }

  console.log(`[check_pb_migrations] OK: ${added.length} new migration(s) validated.`);
}

main();


#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "backend/pb_migrations");
const ALLOWED_TYPES = new Set(["schema", "data", "backfill", "hotfix"]);
const ALLOWED_DOMAINS = new Set([
  "core",
  "velocity",
  "mcsm",
  "translate",
  "security",
  "ops",
]);

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/new_pb_migration.mjs <type> <domain> <slug>",
      "",
      "Where:",
      "  <type>   : schema | data | backfill | hotfix",
      "  <domain> : core | velocity | mcsm | translate | security | ops",
      "  <slug>   : lowercase words, use '_' as separator (e.g. add_posts_index)",
      "",
      "Example:",
      "  node scripts/new_pb_migration.mjs schema core add_posts_index",
    ].join("\n")
  );
  process.exit(1);
}

function sanitizeSlug(raw) {
  const value = `${raw || ""}`.trim().toLowerCase();
  if (!value) return "";
  return value
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function main() {
  const [typeRaw, domainRaw, ...slugParts] = process.argv.slice(2);
  const type = `${typeRaw || ""}`.trim();
  const domain = `${domainRaw || ""}`.trim();
  const slug = sanitizeSlug(slugParts.join("_"));

  if (!ALLOWED_TYPES.has(type) || !ALLOWED_DOMAINS.has(domain) || !slug) {
    usage();
  }

  const epoch = Math.floor(Date.now() / 1000);
  const filename = `${epoch}_${type}_${domain}_${slug}.js`;
  const filePath = path.join(MIGRATIONS_DIR, filename);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Missing migrations dir: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  if (fs.existsSync(filePath)) {
    console.error(`Migration already exists: ${filePath}`);
    process.exit(1);
  }

  const template = `/// <reference path="../pb_data/types.d.ts" />
/**
 * TODO: Summary (1-3 lines)
 *
 * Affects:
 * - collections: TODO
 * - fields/rules/indexes: TODO
 *
 * Compatibility:
 * - TODO (breaking? depends on frontend/backend order?)
 *
 * Data Volume:
 * - TODO (small/medium/large; paging required?)
 *
 * Rollback:
 * - TODO (reversible / no-op with reason / not reversible)
 */
migrate(
  (app) => {
    // TODO: implement up migration
    // Tips:
    // - Use app.findCollectionByNameOrId(name) with try/catch for idempotency
    // - Avoid inserting demo data into production migrations
  },
  (app) => {
    // TODO: implement down migration
    // If no-op, explain why (data irreversible / production no rollback, use fix migration instead)
  },
);
`;

  fs.writeFileSync(filePath, template, "utf8");
  console.log(`[new_pb_migration] Created: ${path.relative(process.cwd(), filePath)}`);
}

main();


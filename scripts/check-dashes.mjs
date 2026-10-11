import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const skipDirs = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".agents",
  ".prisma",
  ".claude",
  "plans",
]);
const skipFiles = new Set([
  "package-lock.json",
  "tsconfig.tsbuildinfo",
  "scripts/check-dashes.mjs",
  "AGENTS.md",
]);
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const banned = [
  { label: "em dash", pattern: new RegExp(EM, "g") },
  { label: "en dash", pattern: new RegExp(EN, "g") },
  { label: "em dash entity", pattern: /&mdash;/gi },
  { label: "en dash entity", pattern: /&ndash;/gi },
  { label: "em dash escape", pattern: new RegExp("\\\\u2014", "gi") },
  { label: "en dash escape", pattern: new RegExp("\\\\u2013", "gi") },
];

const findings = [];

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function scan(filePath) {
  const buffer = readFileSync(filePath);
  if (isBinary(buffer)) return;
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { label, pattern } of banned) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({
          file: relative(root, filePath).split(sep).join("/"),
          line: index + 1,
          label,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") && entry !== ".env.example") {
      if (skipDirs.has(entry)) continue;
      if (entry === ".github") continue;
      if (entry === ".agents") continue;
    }
    const full = join(dir, entry);
    const rel = relative(root, full).split(sep).join("/");
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (skipDirs.has(entry)) continue;
      walk(full);
    } else if (stats.isFile() && !skipFiles.has(rel)) {
      scan(full);
    }
  }
}

walk(root);

if (findings.length > 0) {
  console.error(`check:dashes found ${findings.length} banned dash character(s):\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.label}  ${finding.text}`);
  }
  process.exit(1);
}

console.log("check:dashes passed. No em dash or en dash characters found.");

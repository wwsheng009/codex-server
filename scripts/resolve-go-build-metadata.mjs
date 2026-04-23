#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");

const args = process.argv.slice(2);
let field = "ldflags";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--field" && index + 1 < args.length) {
    field = String(args[index + 1]).trim();
    index += 1;
  }
}

const metadata = resolveMetadata();

switch (field) {
  case "version":
    process.stdout.write(metadata.version);
    break;
  case "commit":
    process.stdout.write(metadata.commit);
    break;
  case "buildTime":
    process.stdout.write(metadata.buildTime);
    break;
  case "ldflags":
    process.stdout.write(metadata.ldflags);
    break;
  default:
    console.error(
      `Unsupported --field value "${field}". Use version, commit, buildTime, or ldflags.`,
    );
    process.exit(1);
}

function resolveMetadata() {
  const version =
    readNonEmptyEnv("CODEX_SERVER_BUILD_VERSION") ||
    tryGit(["describe", "--tags", "--always", "--dirty", "--match", "v*"]) ||
    "dev";
  const commit =
    readNonEmptyEnv("CODEX_SERVER_BUILD_COMMIT") ||
    tryGit(["rev-parse", "HEAD"]) ||
    "unknown";
  const buildTime = normalizeBuildTime(
    readNonEmptyEnv("CODEX_SERVER_BUILD_TIME") || currentBuildTime(),
  );

  return {
    version,
    commit,
    buildTime,
    ldflags: [
      `-X codex-server/backend/internal/buildinfo.Version=${version}`,
      `-X codex-server/backend/internal/buildinfo.Commit=${commit}`,
      `-X codex-server/backend/internal/buildinfo.BuildTime=${buildTime}`,
    ].join(" "),
  };
}

function readNonEmptyEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function tryGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function currentBuildTime() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeBuildTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    console.error(
      `Invalid CODEX_SERVER_BUILD_TIME value "${value}". Use an RFC3339 timestamp.`,
    );
    process.exit(1);
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

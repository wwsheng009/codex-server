#!/usr/bin/env bash
set -euo pipefail

PACKAGE_MANAGER="${PACKAGE_MANAGER:-auto}"
GO_BUILD_TAGS="${GO_BUILD_TAGS:-embed_frontend}"
OUTPUT_PATH="${OUTPUT_PATH:-}"
PYTHON_BIN="${PYTHON_BIN:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
FRONTEND_DIST_DIR="$FRONTEND_DIR/dist"
BACKEND_DIR="$REPO_ROOT/backend"
BACKEND_WEBUI_DIR="$BACKEND_DIR/internal/webui"
EMBEDDED_DIST_DIR="$BACKEND_WEBUI_DIR/dist"

if [[ -z "$OUTPUT_PATH" ]]; then
  OUTPUT_PATH="$BACKEND_DIR/bin/codex-server-embedded"
fi

normalize_path() {
  "$PYTHON_BIN" - <<'PY' "$1"
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
}

assert_within_root() {
  local path root label normalized_path normalized_root
  path="$1"
  root="$2"
  label="$3"
  normalized_path="$(normalize_path "$path")"
  normalized_root="$(normalize_path "$root")"

  case "$normalized_path" in
    "$normalized_root" | "$normalized_root"/*) ;;
    *)
      echo "$label path '$normalized_path' is outside repository root '$normalized_root'." >&2
      exit 1
      ;;
  esac

  printf '%s\n' "$normalized_path"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found in PATH." >&2
    exit 1
  fi
}

run_command() {
  local workdir failure_message
  workdir="$1"
  failure_message="$2"
  shift 2

  echo "> $*"
  (
    cd "$workdir"
    "$@"
  ) || {
    local exit_code=$?
    echo "$failure_message (exit code $exit_code)." >&2
    exit "$exit_code"
  }
}

FRONTEND_DIR="$(assert_within_root "$FRONTEND_DIR" "$REPO_ROOT" "Frontend directory")"
FRONTEND_DIST_DIR="$(assert_within_root "$FRONTEND_DIST_DIR" "$REPO_ROOT" "Frontend dist directory")"
BACKEND_DIR="$(assert_within_root "$BACKEND_DIR" "$REPO_ROOT" "Backend directory")"
BACKEND_WEBUI_DIR="$(assert_within_root "$BACKEND_WEBUI_DIR" "$REPO_ROOT" "Embedded frontend directory")"
EMBEDDED_DIST_DIR="$(assert_within_root "$EMBEDDED_DIST_DIR" "$REPO_ROOT" "Embedded dist directory")"
OUTPUT_PATH="$(assert_within_root "$OUTPUT_PATH" "$REPO_ROOT" "Output binary")"

if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "Frontend directory not found: $FRONTEND_DIR" >&2
  exit 1
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Backend directory not found: $BACKEND_DIR" >&2
  exit 1
fi

case "$PACKAGE_MANAGER" in
  auto)
    if [[ -f "$FRONTEND_DIR/package-lock.json" ]]; then
      PACKAGE_MANAGER="npm"
    elif [[ -f "$FRONTEND_DIR/pnpm-lock.yaml" ]]; then
      PACKAGE_MANAGER="pnpm"
    else
      PACKAGE_MANAGER="npm"
    fi
    ;;
  npm|pnpm) ;;
  *)
    echo "Unsupported PACKAGE_MANAGER '$PACKAGE_MANAGER'. Use auto, npm, or pnpm." >&2
    exit 1
    ;;
esac

require_command "$PACKAGE_MANAGER"
require_command go

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Required command 'python3' or 'python' was not found in PATH." >&2
    exit 1
  fi
else
  require_command "$PYTHON_BIN"
fi

echo "Repository root: $REPO_ROOT"
echo "Frontend builder: $PACKAGE_MANAGER"
echo "Path normalizer: $PYTHON_BIN"
echo "Embedded dist target: $EMBEDDED_DIST_DIR"
echo "Binary output: $OUTPUT_PATH"

run_command "$FRONTEND_DIR" "Frontend build failed" "$PACKAGE_MANAGER" run build

if [[ ! -d "$FRONTEND_DIST_DIR" ]]; then
  echo "Frontend build completed without producing dist output: $FRONTEND_DIST_DIR" >&2
  exit 1
fi

if [[ -z "$(find "$FRONTEND_DIST_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "Frontend dist directory is empty: $FRONTEND_DIST_DIR" >&2
  exit 1
fi

mkdir -p "$BACKEND_WEBUI_DIR"
rm -rf "$EMBEDDED_DIST_DIR"
mkdir -p "$EMBEDDED_DIST_DIR"
cp -a "$FRONTEND_DIST_DIR"/. "$EMBEDDED_DIST_DIR"/

if [[ ! -f "$EMBEDDED_DIST_DIR/index.html" ]]; then
  echo "Embedded frontend copy failed; missing index.html at $EMBEDDED_DIST_DIR/index.html" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
run_command "$BACKEND_DIR" "Go build failed" go build -tags "$GO_BUILD_TAGS" -o "$OUTPUT_PATH" ./cmd/server

if [[ ! -f "$OUTPUT_PATH" ]]; then
  echo "Go build reported success but binary was not created: $OUTPUT_PATH" >&2
  exit 1
fi

echo "Embedded frontend build completed successfully."
echo "Built binary: $OUTPUT_PATH"

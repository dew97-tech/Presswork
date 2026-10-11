#!/usr/bin/env bash
# migrate-opencode-v2.sh v2.0.0
# Cross-platform OpenCode V1 -> V2 migration, fresh install, repair and rollback.
#
# Supported:
#   - Windows Git Bash / MSYS2 / Cygwin (MINGW, MSYS, CYGWIN)
#   - Linux (Arch/Omarchy, Debian, Fedora, generic), including WSL detection
#   - macOS (best effort: curl/npm/bun/pnpm/yarn/brew)
#
# Safety: verified backup before any removal; aborts on any mismatch;
# never deletes a backup; interactive confirmation on destructive steps.

set -euo pipefail

SCRIPT_VERSION="2.0.0"
TS="$(date +%Y%m%d-%H%M%S)"

MODE="auto"          # auto|doctor|verify|repair|rollback
METHOD="auto"        # auto|curl|npm|bun|pnpm|yarn|brew|aur|mise
DRY_RUN=0
YES=0
SHELL_FIX=1
BK_OVERRIDE=""
ROLLBACK_FROM=""

OS=""; WSL=0; DISTRO=""; OMARCHY=0
DATA=""; STATE=""; CONF=""; CACHE=""; DB=""
BK=""; LIVE_JSON=""; LIVE_SESSIONS=""
HAVE_DATA=0; HAVE_V1=0; HAVE_V2=0

RES_PATH=""; RES_VER=""; RES_SRC=""
CURL_PATH=""; CURL_VER=""
NPM_V1=0; NPM_V2=0; BUN_V1=0; PNPM_V1=0; BREW_V1=0
MISE_TOOL=""; MISE_BIN=""; MISE_VER=""; MISE_REG=""
SYS_PKG=""; SYS_VER=""
V2_BIN=""
INSTALLS=()

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
OpenCode V1 -> V2 migration / install / repair (cross-platform)

Usage: migrate-opencode-v2.sh [options]

Modes (default: auto-detect and guide):
  --doctor              Detect and report only; change nothing
  --dry-run             Show the planned actions without executing them
  --verify              Verify an existing V2 installation
  --repair              Re-apply shell health setup to an existing V2 install
  --rollback BK         Restore a previous backup and reinstall V1 if it existed

Options:
  --method M            curl|npm|bun|pnpm|yarn|brew|aur|mise (default: ask)
  --backup-dir PATH     Backup destination (default: /g if present, else $HOME)
  --skip-shell-fix      Do not modify shell configuration / env vars
  --yes, -y             Non-interactive (answer yes to confirmations)
  -h, --help            Show this help
EOF
}

# ---------------------------------------------------------------- arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --doctor)        MODE="doctor"; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --verify)        MODE="verify"; shift ;;
    --repair)        MODE="repair"; shift ;;
    --rollback)      [ -n "${2:-}" ] || die "--rollback needs a backup dir"; MODE="rollback"; ROLLBACK_FROM="$2"; shift 2 ;;
    --method)        [ -n "${2:-}" ] || die "--method needs a value"; METHOD="$2"; shift 2 ;;
    --backup-dir)    [ -n "${2:-}" ] || die "--backup-dir needs a path"; BK_OVERRIDE="$2"; shift 2 ;;
    --skip-shell-fix) SHELL_FIX=0; shift ;;
    --yes|-y)        YES=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

trap 'rc=$?; if [ $rc -ne 0 ]; then printf "[%s] ABORTED (exit %s). No data was deleted. Backup: %s\n" "$(date +%H:%M:%S)" "$rc" "${BK:-<none>}" >&2; fi' ERR

have() { command -v "$1" >/dev/null 2>&1; }
is_tty() { [ -t 0 ] && [ -t 1 ]; }

curl_bin() {
  if [ -x "$HOME/.opencode/bin/opencode" ]; then printf '%s\n' "$HOME/.opencode/bin/opencode"; return 0; fi
  if [ -x "$HOME/.opencode/bin/opencode.exe" ]; then printf '%s\n' "$HOME/.opencode/bin/opencode.exe"; return 0; fi
  return 1
}

opencode_running() {
  if [ "$OS" = "windows" ]; then
    powershell.exe -NoProfile -Command "if (Get-Process -Name opencode -ErrorAction SilentlyContinue) { 'yes' }" 2>/dev/null | tr -d '\r' | grep -q yes
    return $?
  fi
  if have pgrep; then pgrep -x opencode >/dev/null 2>&1; return $?; fi
  return 1
}

ensure_not_running() {
  if opencode_running; then
    if [ "$DRY_RUN" = 1 ]; then warn "OpenCode is running; a real run would stop and wait."; return 0; fi
    die "OpenCode is running. Close all OpenCode windows (or run 'opencode service stop') and re-run."
  fi
}

confirm() {
  [ "$YES" = 1 ] && return 0
  is_tty || die "Non-interactive shell: pass --yes to proceed with: $1"
  local a=""
  read -r -p "$1 [y/N] " a || true
  [[ "$a" =~ ^[Yy]$ ]]
}

choose() { # $1 prompt, rest options -> prints 1-based index on stdout
  local prompt="$1"; shift
  local -a opts=("$@")
  if [ "$YES" = 1 ] || ! is_tty; then echo 1; return 0; fi
  printf '%s\n' "$prompt" >&2
  local i=1
  for o in "${opts[@]}"; do printf '  [%d] %s\n' "$i" "$o" >&2; i=$((i+1)); done
  local pick=""
  while :; do
    read -r -p "Choice [1]: " pick || true
    pick="${pick:-1}"
    if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le "${#opts[@]}" ]; then
      echo "$pick"; return 0
    fi
    printf 'Invalid choice.\n' >&2
  done
}

is_v2() { [ -n "${1:-}" ] && [ "${1%%.*}" -ge 2 ] 2>/dev/null; }
is_v1() { [ -n "${1:-}" ] && [ "${1%%.*}" -lt 2 ] 2>/dev/null; }

version_of() {
  "$1" --version 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1 || true
}

# ---------------------------------------------------------------- detection
detect_env() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    Darwin*)              OS="macos" ;;
    Linux*)
      OS="linux"
      if grep -qi microsoft /proc/version 2>/dev/null; then WSL=1; fi
      ;;
    *) die "Unsupported OS: $(uname -s)" ;;
  esac

  if [ "$OS" != "windows" ] && [ -r /etc/os-release ]; then
    DISTRO="$(grep -E '^ID=' /etc/os-release | head -1 | cut -d= -f2 | tr -d '"')"
    DISTRO="${DISTRO:-unknown}"
    if [ "$DISTRO" = "arch" ] || [ "$DISTRO" = "archarm" ]; then
      if have omarchy || [ -d /usr/share/omarchy ]; then DISTRO="omarchy"; OMARCHY=1; fi
    fi
  fi

  DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
  STATE="${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
  CONF="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
  DB="$DATA/opencode.db"

  if [ -f "$DB" ]; then HAVE_DATA=1; fi
  if [ -d "$CONF" ] || [ -d "$STATE" ]; then HAVE_DATA=1; fi
}

source_of() {
  case "$1" in
    *mise*)                              echo "mise" ;;
    *.opencode/bin/*|*.opencode\\bin\\*) echo "curl" ;;
    *".bun"*)                            echo "bun" ;;
    *pnpm*)                              echo "pnpm" ;;
    *node_modules*)                      echo "npm" ;;
    /usr/bin/*|/usr/local/bin/*|/opt/*)  echo "system" ;;
    *)                                   echo "unknown" ;;
  esac
}

inspect_installs() {
  INSTALLS=()
  local p v s

  p="$(command -v opencode 2>/dev/null || true)"
  if [ -n "$p" ]; then
    v="$(version_of "$p")"; s="$(source_of "$p")"
    RES_PATH="$p"; RES_VER="$v"; RES_SRC="$s"
    INSTALLS+=("PATH opencode: $p | ${v:-unknown} | $s")
  fi

  local cb=""
  cb="$(curl_bin 2>/dev/null || true)"
  if [ -n "$cb" ]; then
    CURL_PATH="$cb"
    CURL_VER="$(version_of "$CURL_PATH")"
    if [ "$CURL_PATH" != "$p" ]; then
      INSTALLS+=("curl binary: $CURL_PATH | ${CURL_VER:-unknown} | curl")
    fi
  fi

  if have npm; then
    local g=""
    g="$(npm ls -g --depth=0 2>/dev/null || true)"
    if grep -q 'opencode-ai@' <<<"$g"; then
      NPM_V1=1
      local nv; nv="$(grep -oE 'opencode-ai@[0-9][0-9.]*' <<<"$g" | head -1 | cut -d@ -f2 || true)"
      INSTALLS+=("npm global: opencode-ai | ${nv:-unknown} | npm-v1")
    fi
    if grep -q '@opencode/cli@' <<<"$g"; then
      NPM_V2=1
      local cv; cv="$(grep -oE '@opencode/cli@[0-9][0-9.]*' <<<"$g" | head -1 | awk -F'@' '{print $NF}' || true)"
      INSTALLS+=("npm global: @opencode/cli | ${cv:-unknown} | npm-v2")
    fi
  fi

  if have bun; then
    if bun pm ls -g 2>/dev/null | grep -q 'opencode-ai'; then
      BUN_V1=1; INSTALLS+=("bun global: opencode-ai | unknown | bun-v1")
    fi
  fi

  if have pnpm; then
    if pnpm list -g --depth=0 2>/dev/null | grep -q 'opencode-ai'; then
      PNPM_V1=1; INSTALLS+=("pnpm global: opencode-ai | unknown | pnpm-v1")
    fi
  fi

  if [ "$OS" != "windows" ] && have mise; then
    local mb=""
    mb="$(mise which opencode 2>/dev/null || true)"
    if [ -n "$mb" ] && [ -x "$mb" ]; then
      MISE_TOOL="opencode"; MISE_BIN="$mb"; MISE_VER="$(version_of "$mb")"
      MISE_REG="$(mise registry 2>/dev/null | grep -E '^opencode[[:space:]]' | head -1 || true)"
      INSTALLS+=("mise: $mb | ${MISE_VER:-unknown} | mise (${MISE_REG:-registry unknown})")
    fi
  fi

  if [ "$OS" = "linux" ] || [ "$WSL" = 1 ]; then
    if have pacman && [ -n "$RES_PATH" ]; then
      local rp; rp="$(readlink -f "$RES_PATH" 2>/dev/null || echo "$RES_PATH")"
      SYS_PKG="$(pacman -Qo "$rp" 2>/dev/null | awk '{print $(NF-1)}' || true)"
      if [ -n "$SYS_PKG" ]; then SYS_VER="$RES_VER"; INSTALLS+=("pacman package: $SYS_PKG | ${SYS_VER:-unknown} | system"); fi
    fi
  fi

  if [ "$OS" = "macos" ] && have brew && brew list --versions opencode >/dev/null 2>&1; then
    BREW_V1=1
    INSTALLS+=("brew: opencode | unknown | brew")
  fi

  # classify
  HAVE_V1=0; HAVE_V2=0
  if is_v1 "$RES_VER"; then HAVE_V1=1; fi
  if is_v1 "$CURL_VER" && [ "$CURL_PATH" != "$RES_PATH" ]; then HAVE_V1=1; fi
  if [ "$MISE_TOOL" = "opencode" ] && is_v1 "$MISE_VER"; then HAVE_V1=1; fi
  if [ "$NPM_V1" = 1 ] || [ "$BUN_V1" = 1 ] || [ "$PNPM_V1" = 1 ] || [ "$BREW_V1" = 1 ]; then HAVE_V1=1; fi

  if is_v2 "$RES_VER"; then HAVE_V2=1; V2_BIN="$RES_PATH"; fi
  if is_v2 "$CURL_VER"; then HAVE_V2=1; [ -n "$V2_BIN" ] || V2_BIN="$CURL_PATH"; fi
  if [ "$NPM_V2" = 1 ]; then HAVE_V2=1; fi
}

report() {
  log "=== OpenCode migration doctor (script $SCRIPT_VERSION) ==="
  local osline="OS: $OS"
  if [ "$WSL" = 1 ]; then osline="$osline (WSL)"; fi
  if [ -n "$DISTRO" ]; then osline="$osline | distro: $DISTRO"; fi
  if [ "$OMARCHY" = 1 ]; then osline="$osline | Omarchy detected"; fi
  log "$osline"
  if [ "$OS" = "windows" ]; then log "Shell: Git Bash ($(uname -s))"; else log "Shell: ${SHELL:-unknown}"; fi
  local managers="" m
  for m in curl tar node npm bun pnpm yarn brew pacman yay paru mise sqlite3; do
    if have "$m"; then managers="$managers $m"; fi
  done
  log "Tools:$managers"
  if [ "${#INSTALLS[@]}" -gt 0 ]; then
    log "OpenCode installs found:"
    local i
    for ((i=0; i<${#INSTALLS[@]}; i++)); do log "  - ${INSTALLS[$i]}"; done
  else
    log "OpenCode installs found: none"
  fi
  if [ -f "$DB" ]; then
    log "Data: $DB ($(du -h "$DB" 2>/dev/null | cut -f1 || echo '?') )"
  else
    log "Data: no database at $DB"
  fi
  if [ "$WSL" = 1 ]; then warn "WSL detected. Install OpenCode in the same side (Windows or WSL) as your project files."; fi
}

# ---------------------------------------------------------------- db helpers
db_json() {
  if have node; then
    DB_PATH="$1" node --no-warnings -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
      const c = (t) => db.prepare("SELECT COUNT(*) AS c FROM " + t).get().c;
      console.log(JSON.stringify({ sessions: c("session"), messages: c("message"), parts: c("part"), projects: c("project") }));
      db.close();
    ' 2>/dev/null && return 0
  fi
  if have sqlite3; then
    local out=""
    out="$(sqlite3 "$1" "SELECT '{\"sessions\":'||(SELECT COUNT(*) FROM session)||',\"messages\":'||(SELECT COUNT(*) FROM message)||',\"parts\":'||(SELECT COUNT(*) FROM part)||',\"projects\":'||(SELECT COUNT(*) FROM project)||'}'" 2>/dev/null || true)"
    if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  fi
  return 1
}

db_integrity() {
  if have node; then
    DB_PATH="$1" node --no-warnings -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
      const r = db.prepare("PRAGMA quick_check(1)").get();
      console.log(r.quick_check || Object.values(r)[0] || "unknown");
      db.close();
    ' 2>/dev/null && return 0
  fi
  if have sqlite3; then
    sqlite3 "$1" "PRAGMA quick_check(1);" 2>/dev/null && return 0
  fi
  echo "unavailable"
}

db_worktrees() {
  if have node; then
    DB_PATH="$1" node --no-warnings -e '
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
      for (const r of db.prepare("SELECT DISTINCT worktree FROM project").all()) console.log(r.worktree);
      db.close();
    ' 2>/dev/null && return 0
  fi
  if have sqlite3; then
    sqlite3 "$1" "SELECT DISTINCT worktree FROM project;" 2>/dev/null && return 0
  fi
  return 1
}

# ---------------------------------------------------------------- backup
pick_backup_dir() {
  if [ -n "$BK_OVERRIDE" ]; then BK="$BK_OVERRIDE"; return; fi
  if [ "$OS" = "windows" ] && [ -d /g ]; then BK="G:/opencode-v1-backup-$TS"; else BK="$HOME/opencode-backup-$TS"; fi
}

free_space_kb() {
  local target="$1"
  case "$target" in
    [Gg]:*) target=/g ;;
    [Cc]:*) target=/c ;;
  esac
  df -Pk "$target" 2>/dev/null | awk 'NR==2{print $4}'
}

do_backup() {
  ensure_not_running
  pick_backup_dir
  [ -e "$BK" ] && die "Backup directory already exists: $BK"
  local need avail
  need=$(du -sk "$DATA" "$STATE" "$CONF" 2>/dev/null | awk '{s+=$1} END{print s+0}')
  need=$((need + 300*1024))
  avail="$(free_space_kb "$BK")"
  if [ "${avail:-0}" -le "$need" ]; then die "Need ~$((need/1024)) MB free, have ${avail:-0} KB at $BK"; fi

  mkdir -p "$BK/data" "$BK/state" "$BK/config" "$BK/projects"
  exec > >(tee -a "$BK/migration.log") 2>&1
  log "=== OpenCode V1 -> V2 migration (script $SCRIPT_VERSION) ==="
  log "Backup dir: $BK"

  if [ -f "$DB" ]; then
    LIVE_JSON="$(db_json "$DB")" || die "Could not read the live database (install node or sqlite3, then retry)"
    LIVE_SESSIONS="$(printf '%s' "$LIVE_JSON" | sed -n 's/.*"sessions":\([0-9]*\).*/\1/p')"
    log "Live DB: $LIVE_JSON"
  fi

  local f d
  for f in opencode.db opencode.db-wal opencode.db-shm auth.json mcp-auth.json; do
    if [ -f "$DATA/$f" ]; then cp "$DATA/$f" "$BK/data/"; fi
  done
  for d in storage snapshot tool-output plans; do
    if [ -d "$DATA/$d" ]; then cp -r "$DATA/$d" "$BK/data/"; fi
  done
  if [ -d "$STATE" ]; then cp -r "$STATE" "$BK/state/opencode"; fi
  if [ -d "$CONF" ]; then
    mkdir -p "$BK/config/opencode"
    (cd "$CONF" && tar --exclude='./node_modules' -cf - . 2>/dev/null) | (cd "$BK/config/opencode" && tar -xf -) || warn "config copy had errors"
  fi

  if [ -f "$DB" ] && [ -n "$LIVE_JSON" ]; then
    local wts i=0
    wts="$(db_worktrees "$DB" || true)"
    while IFS= read -r wt; do
      [ -n "$wt" ] || continue
      [ "$wt" = "/" ] && continue
      i=$((i+1))
      local safe dest
      safe="$(printf '%s' "$wt" | sed 's#[^A-Za-z0-9._-]#_#g' | cut -c1-80)"
      dest="$BK/projects/$(printf '%02d' "$i")-$safe"
      if [ ! -d "$wt" ]; then warn "project dir missing, skipped: $wt"; continue; fi
      mkdir -p "$dest"
      for f in .opencode .agents .claude opencode.json opencode.jsonc AGENTS.md CLAUDE.md; do
        if [ -e "$wt/$f" ]; then
          (cd "$wt" && tar --exclude='node_modules' -cf - "$f" 2>/dev/null) | (cd "$dest" && tar -xf -) || warn "could not back up $wt/$f"
        fi
      done
    done <<< "$wts"
  fi

  if [ -f "$DB" ] && [ -n "$LIVE_JSON" ]; then
    local src_size bak_size bak
    src_size="$(stat -c %s "$DB" 2>/dev/null || stat -f %z "$DB")"
    bak_size="$(stat -c %s "$BK/data/opencode.db" 2>/dev/null || stat -f %z "$BK/data/opencode.db")"
    [ "$src_size" = "$bak_size" ] || die "Backup size mismatch ($src_size vs $bak_size); live data untouched"
    bak="$(db_json "$BK/data/opencode.db")" || die "Backup DB cannot be opened (live data untouched)"
    [ "$bak" = "$LIVE_JSON" ] || die "Backup verification FAILED: counts differ (live data untouched)"
    log "Counts match. Running integrity check on the backup copy (may take a few minutes) ..."
    local icheck; icheck="$(db_integrity "$BK/data/opencode.db")"
    [ "$icheck" = "ok" ] || die "Backup integrity check failed: $icheck (live data untouched)"
    log "Backup integrity check passed."
  fi

  {
    echo "date=$(date -Iseconds 2>/dev/null || date)"
    echo "script=$SCRIPT_VERSION"
    echo "backup_dir=$BK"
    echo "os=$OS"
    echo "distro=$DISTRO"
    echo "live=$LIVE_JSON"
    echo "v1_source=$V1_SOURCE"
    echo "v1_version=$V1_VERSION"
    echo "v1_tool=$MISE_TOOL"
  } > "$BK/manifest.txt"

  log "Backup complete and verified: $BK"
}

# ---------------------------------------------------------------- versions/sources
V1_SOURCE=""; V1_VERSION=""

set_v1_info() {
  if [ "$MISE_TOOL" = "opencode" ] && is_v1 "$MISE_VER"; then
    V1_SOURCE="mise"; V1_VERSION="$MISE_VER"; return
  fi
  if is_v1 "$RES_VER"; then
    V1_SOURCE="$RES_SRC"; V1_VERSION="$RES_VER"; return
  fi
  if [ "$NPM_V1" = 1 ]; then V1_SOURCE="npm"; V1_VERSION=""; return; fi
  if [ "$BUN_V1" = 1 ]; then V1_SOURCE="bun"; V1_VERSION=""; return; fi
  if [ "$PNPM_V1" = 1 ]; then V1_SOURCE="pnpm"; V1_VERSION=""; return; fi
  if [ "$BREW_V1" = 1 ]; then V1_SOURCE="brew"; V1_VERSION=""; return; fi
  V1_SOURCE="unknown"
}

# ---------------------------------------------------------------- removal
remove_v1() {
  set_v1_info
  log "Removing V1 ($V1_SOURCE ${V1_VERSION:-}) ..."
  case "$V1_SOURCE" in
    mise)
      mise uninstall opencode || warn "mise uninstall opencode failed"
      ;;
    npm)
      npm uninstall -g opencode-ai || warn "npm uninstall failed"
      rm -rf "$HOME/AppData/Roaming/npm/node_modules/@opencode/cli" 2>/dev/null || true
      rm -rf "$HOME/AppData/Roaming/npm/node_modules/.opencode-ai-"* 2>/dev/null || true
      rm -f "$HOME/AppData/Roaming/npm/opencode" "$HOME/AppData/Roaming/npm/opencode.cmd" "$HOME/AppData/Roaming/npm/opencode.ps1" 2>/dev/null || true
      ;;
    bun)
      bun remove -g opencode-ai 2>/dev/null || bun uninstall -g opencode-ai 2>/dev/null || warn "bun uninstall failed; remove opencode-ai manually"
      ;;
    pnpm)
      pnpm remove -g opencode-ai || warn "pnpm remove failed"
      ;;
    brew)
      brew uninstall opencode || warn "brew uninstall failed"
      ;;
    system)
      if [ -n "$SYS_PKG" ]; then
        log "System package $SYS_PKG requires sudo to remove."
        confirm "Remove system package $SYS_PKG?" || die "Cancelled"
        sudo pacman -Rns --noconfirm "$SYS_PKG" || warn "pacman removal failed"
      fi
      ;;
    curl)
      if [ "$METHOD" != "curl" ] && [ -x "$HOME/.opencode/bin/opencode" ]; then
        if [ -n "$BK" ]; then mv "$HOME/.opencode/bin/opencode" "$BK/data/opencode.bin.v1"; else mv "$HOME/.opencode/bin/opencode" "$HOME/.opencode/bin/opencode.v1"; fi
        log "Moved old curl V1 binary aside."
      fi
      ;;
    *)
      warn "Unknown V1 source; remove it manually if it still shadows V2."
      ;;
  esac
  if [ "$NPM_V1" = 1 ] && [ "$V1_SOURCE" != "npm" ]; then npm uninstall -g opencode-ai >/dev/null 2>&1 || true; fi
  hash -r 2>/dev/null || true
}

# ---------------------------------------------------------------- install
available_methods() {
  METHODS=(); METHOD_LABELS=()
  if [ "$OS" = "windows" ]; then
    METHODS+=("curl");  METHOD_LABELS+=("curl installer (recommended)")
    if have npm; then METHODS+=("npm"); METHOD_LABELS+=("npm -g @opencode/cli"); fi
    return
  fi
  if [ "$MISE_TOOL" = "opencode" ]; then
    METHODS+=("mise"); METHOD_LABELS+=("mise: replace with npm:@opencode/cli (keeps Omarchy ecosystem)")
  fi
  METHODS+=("curl"); METHOD_LABELS+=("curl installer (native binary in ~/.opencode/bin)")
  if have yay || have paru; then METHODS+=("aur"); METHOD_LABELS+=("AUR package opencode-beta (system-managed)"); fi
  if have npm; then METHODS+=("npm"); METHOD_LABELS+=("npm -g @opencode/cli"); fi
  if have bun; then METHODS+=("bun"); METHOD_LABELS+=("bun -g @opencode/cli"); fi
  if have pnpm; then METHODS+=("pnpm"); METHOD_LABELS+=("pnpm -g @opencode/cli"); fi
  if have yarn; then METHODS+=("yarn"); METHOD_LABELS+=("yarn global add @opencode/cli"); fi
  if have brew; then METHODS+=("brew"); METHOD_LABELS+=("brew anomalyco/tap/opencode-v2"); fi
}

install_v2() {
  case "$METHOD" in
    curl)
      log "Installing V2 via official curl installer ..."
      curl -fsSL https://opencode.ai/v2/install | bash
      ;;
    npm)  log "Installing @opencode/cli via npm ...";  npm install -g @opencode/cli ;;
    bun)  log "Installing @opencode/cli via bun ...";  bun install -g --trust @opencode/cli ;;
    pnpm) log "Installing @opencode/cli via pnpm ..."; pnpm add -g --allow-build=@opencode/cli @opencode/cli ;;
    yarn) log "Installing @opencode/cli via yarn ..."; yarn global add @opencode/cli ;;
    brew) log "Installing via Homebrew ...";          brew install anomalyco/tap/opencode-v2 ;;
    mise)
      have mise || die "mise not found"
      log "Installing V2 through mise (npm:@opencode/cli) ..."
      mise uninstall opencode >/dev/null 2>&1 || true
      mise use -g npm:@opencode/cli@latest
      mise reshim >/dev/null 2>&1 || true
      ;;
    aur)
      local helper="yay"; have yay || helper="paru"
      have "$helper" || die "No AUR helper (yay/paru) found"
      log "Installing opencode-beta from AUR via $helper (may ask for sudo) ..."
      "$helper" -S --noconfirm opencode-beta
      ;;
    *) die "Unsupported method: $METHOD" ;;
  esac
  hash -r 2>/dev/null || true

  local p="" v=""
  p="$(command -v opencode 2>/dev/null || true)"
  if [ -n "$p" ]; then v="$(version_of "$p")"; fi
  if ! is_v2 "$v"; then
    local cb2=""
    cb2="$(curl_bin 2>/dev/null || true)"
    if [ -n "$cb2" ]; then
      local cv; cv="$(version_of "$cb2")"
      if is_v2 "$cv"; then p="$cb2"; v="$cv"; fi
    fi
  fi
  is_v2 "$v" || die "Install finished but 'opencode --version' is '${v:-not found}'. Check PATH and rerun --doctor."
  V2_BIN="$p"
  log "Installed OpenCode V2 ($v) at $p"
}

# ---------------------------------------------------------------- shell health
set_windows_path() {
  local dir="${BK:-$CONF}"
  mkdir -p "$dir"
  local ps1="$dir/set-windows-path.ps1"
  powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')" > "$dir/windows-user-path.bak.txt" 2>/dev/null || true
  cat > "$ps1" <<'PS1'
$dir = Join-Path $env:USERPROFILE '.opencode\bin'
$p = [Environment]::GetEnvironmentVariable('Path','User')
if ([string]::IsNullOrEmpty($p)) { Write-Output 'Could not read user PATH; skipping.'; exit 0 }
if ($p -like "*$dir*") { Write-Output 'User PATH already contains the opencode bin directory.'; exit 0 }
[Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $dir), 'User')
Write-Output "Added $dir to the Windows user PATH."
PS1
  if have cygpath; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$ps1")" || warn "Could not update Windows user PATH; add $HOME/.opencode/bin manually."
  else
    warn "cygpath not found; add $HOME/.opencode/bin to PATH manually."
  fi
}

shell_fix_windows() {
  log "Applying Windows shell health setup ..."
  mkdir -p "$CONF"
  cat > "$CONF/bash-env.sh" <<'SH'
# OpenCode V2 (Windows): restore the Git Bash (MSYS2) environment for non-login
# bash sessions, such as the OpenCode shell tool spawn (bash -c, without -l).
# Loaded automatically via the user-level BASH_ENV environment variable.
# Safe to source repeatedly.

export MSYSTEM="${MSYSTEM:-MINGW64}"

case ":$PATH:" in
  *":/usr/bin:"*) ;;
  *) export PATH="/mingw64/bin:/usr/local/bin:/usr/bin:/bin:$PATH" ;;
esac
SH

  local winconf=""
  if have cygpath; then winconf="$(cygpath -m "$CONF/bash-env.sh" 2>/dev/null || true)"; fi
  if [ -z "$winconf" ]; then winconf="$CONF/bash-env.sh"; fi
  local cur=""
  cur="$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('BASH_ENV','User')" 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$cur" ]; then
    powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('BASH_ENV','$winconf','User')" >/dev/null 2>&1 || true
    setx BASH_ENV "$winconf" >/dev/null 2>&1 || true
    log "Set user BASH_ENV for the shell tool."
  elif printf '%s' "$cur" | grep -q 'bash-env.sh'; then
    log "BASH_ENV already configured."
  else
    warn "BASH_ENV is already set to '$cur'; leaving it untouched."
  fi

  local rc="$HOME/.bashrc"
  if ! grep -qF "$HOME/.opencode/bin" "$rc" 2>/dev/null; then
    printf '\n# opencode\nexport PATH="$HOME/.opencode/bin:$PATH"\n' >> "$rc"
    log "Added opencode to $rc"
  fi

  set_windows_path
  local b="${V2_BIN:-$(curl_bin 2>/dev/null || true)}"
  if [ -n "$b" ]; then
    "$b" service stop >/dev/null 2>&1 || true
    log "Stopped the running service so the new environment applies. Reopen OpenCode."
  fi
}

shell_fix_unix() {
  log "Applying shell health setup ..."
  local line='export PATH="$HOME/.opencode/bin:$PATH"'
  local wrote=0
  if [ -f "$HOME/.bashrc" ] || [ "${SHELL:-}" = "/bin/bash" ] || [ "${SHELL:-}" = "/usr/bin/bash" ]; then
    if ! grep -qF '.opencode/bin' "$HOME/.bashrc" 2>/dev/null; then
      printf '\n# opencode\n%s\n' "$line" >> "$HOME/.bashrc"; wrote=1
    fi
  fi
  if [ -f "$HOME/.zshrc" ] && ! grep -qF '.opencode/bin' "$HOME/.zshrc" 2>/dev/null; then
    printf '\n# opencode\n%s\n' "$line" >> "$HOME/.zshrc"; wrote=1
  fi
  if [ -f "$HOME/.profile" ] && ! grep -qF '.opencode/bin' "$HOME/.profile" 2>/dev/null; then
    printf '\n# opencode\n%s\n' "$line" >> "$HOME/.profile"; wrote=1
  fi
  if [ -f "$HOME/.config/fish/config.fish" ] && have fish; then
    if ! grep -qF '.opencode/bin' "$HOME/.config/fish/config.fish" 2>/dev/null; then
      printf '\n# opencode\nfish_add_path $HOME/.opencode/bin\n' >> "$HOME/.config/fish/config.fish"; wrote=1
    fi
  fi
  [ "$wrote" = 1 ] && log "Added ~/.opencode/bin to shell configuration." || log "Shell PATH already configured."

  local cb=""
  cb="$(curl_bin 2>/dev/null || true)"
  if [ -n "$cb" ] && [ -d "$HOME/.local/bin" ]; then
    ln -sf "$cb" "$HOME/.local/bin/opencode" 2>/dev/null && log "Symlinked ~/.local/bin/opencode"
  fi
}

apply_shell_fix() {
  [ "$SHELL_FIX" = 1 ] || { log "Shell fix skipped (--skip-shell-fix)."; return 0; }
  if [ "$OS" = "windows" ]; then shell_fix_windows; else shell_fix_unix; fi
}

# ---------------------------------------------------------------- verify
verify_all() {
  log "== Verification =="
  local bin="${V2_BIN:-$(command -v opencode 2>/dev/null || true)}"
  [ -n "$bin" ] || die "opencode not found on PATH"
  [ -x "$bin" ] || bin="$(command -v opencode)"
  local v; v="$(version_of "$bin")"
  is_v2 "$v" || die "Not V2: '${v:-unknown}' at $bin"
  log "Version: $v ($bin)"

  local dbp=""
  dbp="$("$bin" debug paths db 2>/dev/null | tr -d '\r' | tail -1 || true)"
  if [ -n "$dbp" ]; then log "DB path: $dbp"; fi

  local n="?"
  n="$("$bin" session list -n 5000 --format json 2>/dev/null | node --no-warnings -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const a=Array.isArray(j)?j:(j.sessions||[]);console.log(a.length)}catch{console.log("?")}})' 2>/dev/null || echo "?")"
  log "Sessions visible: $n${LIVE_SESSIONS:+ (backup had $LIVE_SESSIONS)}"

  "$bin" auth list 2>/dev/null || warn "auth list failed (check /connect)"
  "$bin" mcp list  2>/dev/null || warn "mcp list failed (servers may need re-auth)"

  local missing=""
  for c in ls cat grep sed awk head tail; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done
  if [ -n "$missing" ]; then
    warn "Shell tool environment still missing:$missing. Restart OpenCode (or the service) and re-run --verify."
  else
    log "Shell environment: coreutils OK."
  fi
}

# ---------------------------------------------------------------- rollback
do_rollback() {
  local src="$1"
  [ -f "$src/data/opencode.db" ] || die "No data/opencode.db in $src"
  if opencode_running; then
    die "OpenCode appears to be running; close it before rollback (or run 'opencode service stop')."
  fi
  local cb=""
  cb="$(curl_bin 2>/dev/null || true)"
  if [ -n "$cb" ]; then "$cb" service stop >/dev/null 2>&1 || true; sleep 2; fi

  exec > >(tee -a "$src/rollback.log") 2>&1
  log "== Rolling back from: $src =="

  local keep="$src/v2-state-rollback"
  mkdir -p "$keep/data" "$keep/state" "$keep/config" 2>/dev/null || true
  for f in opencode.db opencode.db-wal opencode.db-shm; do
    [ -f "$DATA/$f" ] && cp "$DATA/$f" "$keep/data/" 2>/dev/null || true
  done
  [ -d "$STATE" ] && cp -r "$STATE" "$keep/state/opencode" 2>/dev/null || true
  [ -d "$CONF" ] && cp -r "$CONF" "$keep/config/opencode" 2>/dev/null || true

  mkdir -p "$DATA" "$STATE" "$CONF"
  rm -f "$DATA/opencode.db" "$DATA/opencode.db-wal" "$DATA/opencode.db-shm" 2>/dev/null || true
  cp "$src/data/opencode.db" "$DATA/opencode.db"
  for f in opencode.db-wal opencode.db-shm auth.json mcp-auth.json; do
    [ -f "$src/data/$f" ] && cp "$src/data/$f" "$DATA/$f"
  done
  [ -d "$src/data/storage" ] && cp -r "$src/data/storage/." "$DATA/storage/" 2>/dev/null || true
  [ -d "$src/state/opencode" ] && cp -r "$src/state/opencode/." "$STATE/" 2>/dev/null || true
  [ -d "$src/config/opencode" ] && cp -r "$src/config/opencode/." "$CONF/" 2>/dev/null || true

  local vsrc="" vver=""
  if [ -f "$src/manifest.txt" ]; then
    vsrc="$(sed -n 's/^v1_source=//p' "$src/manifest.txt" | head -1)"
    vver="$(sed -n 's/^v1_version=//p' "$src/manifest.txt" | head -1)"
  fi
  log "Reinstalling V1 ($vsrc ${vver:-}) ..."
  case "$vsrc" in
    npm)  npm install -g "opencode-ai${vver:+@$vver}" || warn "Reinstall V1 via npm failed; install opencode-ai manually." ;;
    mise) mise install "opencode${vver:+@$vver}" && mise use -g "opencode${vver:+@$vver}" || warn "Reinstall V1 via mise failed." ;;
    bun)  bun install -g "opencode-ai${vver:+@$vver}" || warn "Reinstall V1 via bun failed." ;;
    pnpm) pnpm add -g "opencode-ai${vver:+@$vver}" || warn "Reinstall V1 via pnpm failed." ;;
    *)    log "Original V1 source was '${vsrc:-unknown}'; reinstall it manually if needed." ;;
  esac
  log "Rollback complete. Previous V2 state preserved at: $keep"
  log "Project files from the backup are at: $src/projects (restore manually if needed)."
}

# ---------------------------------------------------------------- flows
fresh_install() {
  log "No existing OpenCode found. Fresh V2 install."
  available_methods
  if [ "$METHOD" = "auto" ]; then
    local idx; idx="$(choose "How should OpenCode V2 be installed?" "${METHOD_LABELS[@]}")"
    METHOD="${METHODS[$((idx-1))]}"
  fi
  log "Method: $METHOD"
  if [ "$DRY_RUN" = 1 ]; then log "DRY RUN: would install V2 via $METHOD; nothing changed."; return 0; fi
  install_v2
  apply_shell_fix
  verify_all
}

migrate() {
  log "V1 detected. Migration flow."
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY RUN: would back up data, remove V1 ($V1_SOURCE), install V2, apply shell fix, verify."
    return 0
  fi
  confirm "Back up and migrate OpenCode V1 to V2?" || die "Cancelled"
  do_backup
  available_methods
  if [ "$METHOD" = "auto" ]; then
    local idx; idx="$(choose "How should OpenCode V2 be installed?" "${METHOD_LABELS[@]}")"
    METHOD="${METHODS[$((idx-1))]}"
  fi
  log "Method: $METHOD"
  remove_v1
  install_v2
  apply_shell_fix
  verify_all
  log "Done. Backup: $BK"
  log "Rollback: bash \"$0\" --rollback \"$BK\""
}

# ---------------------------------------------------------------- main
main() {
  detect_env
  inspect_installs
  report

  case "$MODE" in
    doctor) exit 0 ;;
    rollback) do_rollback "$ROLLBACK_FROM"; exit 0 ;;
  esac

  if [ "$MODE" = "verify" ] && [ "$HAVE_V2" = 0 ]; then die "No V2 installation found to verify."; fi
  if [ "$MODE" = "repair" ] && [ "$HAVE_V2" = 0 ]; then die "No V2 installation found to repair."; fi

  if [ "$DRY_RUN" = 1 ]; then
    if [ "$HAVE_V2" = 1 ] && [ "$HAVE_V1" = 0 ]; then
      log "DRY RUN: V2 already installed, no V1. Would verify only. Nothing changed."
    elif [ "$HAVE_V1" = 1 ]; then
      set_v1_info
      log "DRY RUN: would back up, remove V1 ($V1_SOURCE), install V2, apply shell fix, verify."
    else
      log "DRY RUN: fresh V2 install would run."
    fi
    exit 0
  fi

  if [ "$HAVE_V2" = 1 ] && [ "$HAVE_V1" = 0 ]; then
    log "V2 already installed; no V1 found."
    case "$MODE" in
      verify) verify_all; exit 0 ;;
      repair) apply_shell_fix; verify_all; exit 0 ;;
    esac
    if [ "$SHELL_FIX" = 1 ]; then
      if confirm "Apply/re-apply shell health setup?"; then apply_shell_fix; fi
    fi
    verify_all
    exit 0
  fi

  if [ "$HAVE_V1" = 1 ] && [ "$HAVE_V2" = 1 ]; then
    warn "Both V1 and V2 installs detected. V1 must be removed so V2 is used."
    if [ "$MODE" = verify ]; then verify_all; exit 0; fi
    if [ "$DRY_RUN" != 1 ]; then
      confirm "Remove V1 and keep V2?" || die "Cancelled"
      do_backup
      remove_v1
      apply_shell_fix
      verify_all
    fi
    exit 0
  fi

  if [ "$HAVE_V1" = 1 ]; then
    migrate
  else
    fresh_install
  fi
}

main "$@"

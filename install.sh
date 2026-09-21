#!/bin/sh
# 거지라우터 설치 스크립트
#
#   curl -fsSL https://geojirouter.vercel.app/i | sh
#
# (geojirouter.vercel.app/i 는 이 파일의 raw 주소로 리다이렉트합니다)
#
# 환경변수:
#   GEOJI_REF    설치할 브랜치/태그 (기본 main)
#   GEOJI_HOME   설치 위치 (기본 ~/.geoji)
#   GEOJI_BINDIR PATH에 걸 심링크 위치 (기본 자동 탐색)

set -eu

REPO="effortprogrammer/geojirouter"
REF="${GEOJI_REF:-main}"
GEOJI_HOME="${GEOJI_HOME:-$HOME/.geoji}"
MIN_BUN_MAJOR=1
MIN_BUN_MINOR=3

say()  { printf '%s\n' "$*"; }
step() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 사전 점검
case "$(uname -s)" in
  Darwin|Linux) ;;
  *) die "지원하지 않는 OS: $(uname -s). Windows는 WSL에서 실행하세요." ;;
esac

command -v curl >/dev/null 2>&1 || die "curl이 필요합니다."
command -v tar  >/dev/null 2>&1 || die "tar가 필요합니다."

# ---------------------------------------------------------------- bun 확보
# CLI가 bun:sqlite / Bun.serve를 쓰므로 bun은 필수 런타임입니다.
find_bun() {
  if command -v bun >/dev/null 2>&1; then command -v bun; return 0; fi
  if [ -x "$HOME/.bun/bin/bun" ]; then printf '%s\n' "$HOME/.bun/bin/bun"; return 0; fi
  return 1
}

BUN="$(find_bun || true)"
if [ -z "$BUN" ]; then
  step "bun이 없어서 설치합니다 (https://bun.sh/install)"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 \
    || die "bun 설치 실패. https://bun.sh 에서 직접 설치한 뒤 다시 실행하세요."
  BUN="$(find_bun || true)"
  [ -n "$BUN" ] || die "bun을 설치했지만 찾지 못했습니다. 새 셸에서 다시 실행하세요."
fi

BUN_VERSION="$("$BUN" --version 2>/dev/null || echo 0.0.0)"
BUN_MAJOR="${BUN_VERSION%%.*}"
BUN_REST="${BUN_VERSION#*.}"
BUN_MINOR="${BUN_REST%%.*}"
if [ "${BUN_MAJOR:-0}" -lt "$MIN_BUN_MAJOR" ] 2>/dev/null ||
   { [ "${BUN_MAJOR:-0}" -eq "$MIN_BUN_MAJOR" ] && [ "${BUN_MINOR:-0}" -lt "$MIN_BUN_MINOR" ]; } 2>/dev/null; then
  warn "bun $BUN_VERSION 입니다. 권장 버전은 $MIN_BUN_MAJOR.$MIN_BUN_MINOR 이상입니다."
fi
step "bun $BUN_VERSION ($BUN)"

# ---------------------------------------------------------------- 소스 받기
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

step "소스 내려받는 중 ($REPO@$REF)"
# curl | tar 로 이으면 curl의 실패가 tar의 종료 코드에 가려지므로 파일로 먼저 받습니다.
curl -fsSL -o "$TMP/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" \
  || die "소스를 받지 못했습니다. 브랜치/태그 이름($REF)과 네트워크를 확인하세요."
tar -xzf "$TMP/src.tar.gz" -C "$TMP" \
  || die "압축을 풀지 못했습니다."
rm -f "$TMP/src.tar.gz"

SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
[ -n "$SRC" ] && [ -f "$SRC/package.json" ] || die "내려받은 소스 구조가 예상과 다릅니다."

# ---------------------------------------------------------------- 빌드
step "의존성 설치 중"
( cd "$SRC" && "$BUN" install --silent >/dev/null 2>&1 ) \
  || die "의존성 설치 실패."

step "빌드 중"
( cd "$SRC" && "$BUN" build src/cli.ts --target=bun --outfile="$TMP/cli.js" >/dev/null ) \
  || die "빌드 실패."

# ---------------------------------------------------------------- 설치
mkdir -p "$GEOJI_HOME/lib" "$GEOJI_HOME/bin"
cp "$TMP/cli.js" "$GEOJI_HOME/lib/cli.js"

# bun 경로를 shim에 박아둡니다. bun이 사용자의 PATH에 없어도 geoji가 동작합니다.
cat > "$GEOJI_HOME/bin/geoji" <<SHIM
#!/bin/sh
exec "$BUN" "$GEOJI_HOME/lib/cli.js" "\$@"
SHIM
chmod +x "$GEOJI_HOME/bin/geoji"

step "설치 위치: $GEOJI_HOME"

# ---------------------------------------------------------------- PATH 연결
link_into() {
  [ -d "$1" ] && [ -w "$1" ] || return 1
  case ":$PATH:" in *":$1:"*) ;; *) return 1 ;; esac
  ln -sf "$GEOJI_HOME/bin/geoji" "$1/geoji" 2>/dev/null || return 1
  printf '%s\n' "$1"
}

LINKED=""
if [ -n "${GEOJI_BINDIR:-}" ]; then
  mkdir -p "$GEOJI_BINDIR"
  ln -sf "$GEOJI_HOME/bin/geoji" "$GEOJI_BINDIR/geoji" && LINKED="$GEOJI_BINDIR"
else
  for dir in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
    LINKED="$(link_into "$dir" || true)"
    [ -n "$LINKED" ] && break
  done
fi

# ---------------------------------------------------------------- 검증
step "검증 중"
VERIFY="$("$GEOJI_HOME/bin/geoji" catalog 2>&1)" \
  || die "설치는 됐지만 실행에 실패했습니다: $VERIFY"
case "$VERIFY" in
  *"provider records"*) say "  $VERIFY" ;;
  *) die "예상치 못한 응답: $VERIFY" ;;
esac

# ---------------------------------------------------------------- 안내
say ""
if [ -n "$LINKED" ]; then
  say "설치 완료. \`geoji\` 를 바로 쓸 수 있습니다. ($LINKED/geoji)"
else
  say "설치 완료. 아래 한 줄을 셸 설정(~/.zshrc 또는 ~/.bashrc)에 추가하세요:"
  say ""
  say "    export PATH=\"$GEOJI_HOME/bin:\$PATH\""
fi
say ""
say "다음 단계:"
say "    geoji init          # 로컬 저장소 생성"
say "    geoji doctor        # 상태 점검"
say "    geoji catalog       # 무료 제공처 목록"
say ""
say "제거: rm -rf \"$GEOJI_HOME\"${LINKED:+ \"$LINKED/geoji\"}"

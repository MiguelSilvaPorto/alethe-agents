#!/usr/bin/env bash
set -euo pipefail

REPO="MiguelSilvaPorto/alethe-agents"
NAME="Alethe"
BINARY="alethe"

# ---------------------------------------------------------------------------
# dry-run: apenas valida o fluxo sem baixar/instalar nada
# ---------------------------------------------------------------------------
ARGS=()
DRY_RUN=false
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then DRY_RUN=true
  else ARGS+=("$arg")
  fi
done
if $DRY_RUN; then
  echo "dry-run: validação de sintaxe OK"
  echo "dry-run: detecta distro + resolve versão + escolhe pacote (simulado)"
  echo "dry-run: nenhum arquivo foi baixado ou instalado"
  exit 0
fi

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
die() { echo "erro: $*" >&2; exit 1; }
info() { echo "  * $*"; }
sudorun() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  else sudo "$@"
  fi
}

cleanup() { rm -rf -- "$TMPDIR"; }
TMPDIR=$(mktemp -d)
trap cleanup EXIT

arch() {
  local a
  a=$(uname -m)
  case "$a" in
    x86_64|amd64)  echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) die "arquitetura não suportada: $a" ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. detecta distro
# ---------------------------------------------------------------------------
PKG_FMT=
PKG_MGR_INST=
PKG_MGR_DEPS=
DISTRO=

if command -v apt &>/dev/null; then
  PKG_FMT="deb"
  PKG_MGR_INST="dpkg -i"
  PKG_MGR_DEPS="apt-get install -f -y"
  DISTRO="deb"
elif command -v dnf &>/dev/null; then
  PKG_FMT="rpm"
  PKG_MGR_INST="dnf install -y"
  PKG_MGR_DEPS=""
  DISTRO="rpm"
elif command -v zypper &>/dev/null; then
  PKG_FMT="rpm"
  PKG_MGR_INST="zypper install -y"
  PKG_MGR_DEPS=""
  DISTRO="rpm"
elif command -v pacman &>/dev/null; then
  PKG_FMT="pkg.tar.zst"
  PKG_MGR_INST="pacman -U --noconfirm"
  PKG_MGR_DEPS=""
  DISTRO="arch"
else
  DISTRO="appimage"
fi

# ---------------------------------------------------------------------------
# 2. descobre versão + baixa pacote
# ---------------------------------------------------------------------------
VERSION="${ARGS[0]:-latest}"
info "detectado: $DISTRO ($(arch))"
info "buscando versão ${VERSION}..."

API="https://api.github.com/repos/${REPO}/releases"
if [ "$VERSION" = "latest" ]; then
  RELEASE_JSON=$(curl -fsSL "${API}/latest")
else
  RELEASE_JSON=$(curl -fsSL "${API}/tags/v${VERSION}")
fi
TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "//;s/".*//')
[ -n "$TAG" ] || die "versão '${VERSION}' não encontrada"

VER="${TAG#v}"

fetch_asset() {
  local pattern="$1"
  local out="$2"
  echo "$RELEASE_JSON" \
    | grep '"browser_download_url"' \
    | grep -E "$pattern" \
    | head -1 \
    | sed 's/.*"browser_download_url": "//;s/".*//' \
    | xargs -r curl -fsSL -o "$out"
}

if [ "$DISTRO" = "appimage" ]; then
  ASSET="${NAME}_${VER}_amd64.AppImage"
  fetch_asset "\.AppImage$" "${TMPDIR}/${ASSET}" \
    || die "AppImage não encontrado para ${TAG}"
  INSTALLER="${TMPDIR}/${ASSET}"
  chmod +x "$INSTALLER"
else
  case "$DISTRO" in
    deb)
      ASSET="${NAME}_${VER}_amd64.deb"
      fetch_asset "_amd64\.deb$" "${TMPDIR}/${ASSET}" \
        || die "pacote .deb não encontrado para ${TAG}"
      ;;
    rpm)
      ASSET="${NAME}-${VER}-1.x86_64.rpm"
      fetch_asset "\.x86_64\.rpm$" "${TMPDIR}/${ASSET}" \
        || die "pacote .rpm não encontrado para ${TAG}"
      ;;
    arch)
      # Arch: tenta .deb primeiro (pode extrair), senão AppImage
      ASSET="${NAME}_${VER}_amd64.deb"
      fetch_asset "_amd64\.deb$" "${TMPDIR}/${ASSET}" \
        || die "pacote não encontrado para ${TAG}"
      PKG_MGR_INST="pacman -U --noconfirm"
      ;;
  esac
  INSTALLER="${TMPDIR}/${ASSET}"
fi

[ -f "$INSTALLER" ] || die "download falhou"

# ---------------------------------------------------------------------------
# 3. instala
# ---------------------------------------------------------------------------
info "instalando ${NAME} ${VER}..."

case "$DISTRO" in
  appimage)
    DEST="/opt/${BINARY}"
    sudorun mkdir -p "$DEST"
    sudorun cp "$INSTALLER" "${DEST}/${BINARY}.AppImage"
    sudorun chmod +x "${DEST}/${BINARY}.AppImage"

    # symlink em /usr/local/bin
    sudorun ln -sf "${DEST}/${BINARY}.AppImage" "/usr/local/bin/${BINARY}"

    # desktop entry
    cat > "${TMPDIR}/${BINARY}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${NAME}
Exec=${DEST}/${BINARY}.AppImage
Icon=${DEST}/icon.png
Terminal=false
Categories=Utility;TerminalEmulator;
Comment=Terminal multiplexer GUI
EOF
    sudorun cp "${TMPDIR}/${BINARY}.desktop" /usr/local/share/applications/

    # icon
    ICON_URL="https://raw.githubusercontent.com/MiguelSilvaPorto/alethe-agents/main/src-tauri/icons/icon.png"
    curl -fsSL "$ICON_URL" -o "${TMPDIR}/icon.png" || true
    if [ -f "${TMPDIR}/icon.png" ]; then
      sudorun cp "${TMPDIR}/icon.png" "${DEST}/icon.png"
    fi
    ;;

  deb)
    if sudorun dpkg -i "$INSTALLER" 2>/dev/null; then
      : ok
    else
      info "resolvendo dependências..."
      sudorun $PKG_MGR_DEPS
    fi
    ;;

  rpm)
    sudorun $PKG_MGR_INST "$INSTALLER"
    ;;

  arch)
    # converte .deb → zst improvisado (extrai + repacota)
    info "extraindo .deb para instalação no Arch..."
    TMP_PKG="${TMPDIR}/pkg"
    mkdir -p "$TMP_PKG"
    bsdtar -xf "$INSTALLER" -C "$TMP_PKG" 2>/dev/null || {
      # fallback: AppImage
      info "fallback para AppImage..."
      ASSET="${NAME}_${VER}_amd64.AppImage"
      fetch_asset "\.AppImage$" "${TMPDIR}/${ASSET}" || die "AppImage não encontrado"
      chmod +x "${TMPDIR}/${ASSET}"
      sudorun mkdir -p "/opt/${BINARY}"
      sudorun cp "${TMPDIR}/${ASSET}" "/opt/${BINARY}/${BINARY}.AppImage"
      sudorun chmod +x "/opt/${BINARY}/${BINARY}.AppImage"
      sudorun ln -sf "/opt/${BINARY}/${BINARY}.AppImage" "/usr/local/bin/${BINARY}"
      info "${NAME} instalado em /opt/${BINARY}/${BINARY}.AppImage"
      exit 0
    }
    # extrai data.tar.* e instala
    DATA_TAR=$(find "$TMP_PKG" -name 'data.tar.*' | head -1)
    [ -n "$DATA_TAR" ] || die "não foi possível extrair o pacote"
    sudorun bsdtar -xf "$DATA_TAR" -C /
    ;;
esac

# ---------------------------------------------------------------------------
# 4. verifica
# ---------------------------------------------------------------------------
if command -v "$BINARY" &>/dev/null; then
  info "${NAME} ${VER} instalado com sucesso!"
  echo ""
  echo "  Execute com: ${BINARY}"
else
  die "algo deu errado — '${BINARY}' não encontrado no PATH"
fi

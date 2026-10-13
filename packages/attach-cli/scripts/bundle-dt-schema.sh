#!/usr/bin/env bash
set -euo pipefail

DTSCHEMA_COMMIT="5687115902ba74c1cd80bdab4772cc2cdfa75778"
DTSCHEMA_URL="https://github.com/devicetree-org/dt-schema.git"
DTC_TAG="v1.8.1"
DTC_URL="https://github.com/dgibson/dtc.git"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DTSCHEMA_DIR="$PKG_ROOT/dt-schema"
DTC_DIR="$PKG_ROOT/dtc"
TOOLS_DIR="$PKG_ROOT/bundled/tools"
SCHEMA_DIR="$PKG_ROOT/bundled/dt-schema"

already_built() {
    [ -x "$TOOLS_DIR/dt-mk-schema" ] && \
        [ -x "$TOOLS_DIR/dt-validate" ] && \
        [ -x "$TOOLS_DIR/dtc" ] && \
        [ -d "$SCHEMA_DIR/dtschema/schemas" ] && \
        [ -d "$DTSCHEMA_DIR/.git" ] && \
        [ "$(git -C "$DTSCHEMA_DIR" rev-parse HEAD 2>/dev/null)" = "$DTSCHEMA_COMMIT" ]
}

if already_built; then
    exit 0
fi

echo "==> Cloning dt-schema at $DTSCHEMA_COMMIT..."
rm -rf "$DTSCHEMA_DIR"
git clone --depth 1 "$DTSCHEMA_URL" "$DTSCHEMA_DIR"
git -C "$DTSCHEMA_DIR" fetch --depth 1 origin "$DTSCHEMA_COMMIT"
git -C "$DTSCHEMA_DIR" checkout "$DTSCHEMA_COMMIT"

echo "==> Cloning dtc at $DTC_TAG..."
rm -rf "$DTC_DIR"
git clone --depth 1 --branch "$DTC_TAG" "$DTC_URL" "$DTC_DIR"

echo "==> Building dtc (static, no yaml)..."
make -C "$DTC_DIR" dtc NO_PYTHON=1 NO_YAML=1 LDFLAGS="-static" -j"$(nproc)" 2>&1 | tail -1
strip "$DTC_DIR/dtc"
mkdir -p "$TOOLS_DIR"
cp "$DTC_DIR/dtc" "$TOOLS_DIR/dtc"

echo "==> Setting up Python venv..."
python3 -m venv "$DTSCHEMA_DIR/.venv"
source "$DTSCHEMA_DIR/.venv/bin/activate"

echo "==> Installing dt-schema and PyInstaller..."
pip install --quiet pyinstaller
pip install --quiet "$DTSCHEMA_DIR"

echo "==> Building dt-mk-schema binary..."
pyinstaller --onefile --name dt-mk-schema \
    --distpath "$TOOLS_DIR" \
    --workpath "$DTSCHEMA_DIR/.pyinstaller-build" \
    --specpath "$DTSCHEMA_DIR/.pyinstaller-build" \
    --collect-data dtschema \
    "$(python3 -c "import dtschema.mk_schema; print(dtschema.mk_schema.__file__)")"

echo "==> Building dt-validate binary..."
pyinstaller --onefile --name dt-validate \
    --distpath "$TOOLS_DIR" \
    --workpath "$DTSCHEMA_DIR/.pyinstaller-build" \
    --specpath "$DTSCHEMA_DIR/.pyinstaller-build" \
    --collect-data dtschema \
    "$(python3 -c "import dtschema.dtb_validate; print(dtschema.dtb_validate.__file__)")"

echo "==> Copying dt-schema schemas..."
rm -rf "$SCHEMA_DIR"
mkdir -p "$SCHEMA_DIR"
cp -r "$DTSCHEMA_DIR/dtschema" "$SCHEMA_DIR/dtschema"

deactivate

echo "==> Done. Bundled tools in $TOOLS_DIR, schemas in $SCHEMA_DIR"

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
# The Linux backend's assets_dir: <package root>/bundled/linux.
BUNDLE_DIR="$PKG_ROOT/bundled/linux"
TOOLS_DIR="$BUNDLE_DIR/tools"
SCHEMA_DIR="$BUNDLE_DIR/dt-schema"

# A binary that prints no version never reached the tool's main().
runs() {
    [ -x "$1" ] && [ -n "$("$1" --version 2>/dev/null)" ]
}

already_built() {
    runs "$TOOLS_DIR/dt-mk-schema" && \
        runs "$TOOLS_DIR/dt-validate" && \
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

# The dtschema modules have no __main__ block (pip reaches main() through
# entry points), so PyInstaller gets a small script that calls it.
build_tool() {
    local name="$1" module="$2"
    local entry="$DTSCHEMA_DIR/.pyinstaller-build/$name.py"
    echo "==> Building $name binary..."
    mkdir -p "$(dirname "$entry")"
    printf 'import sys\nfrom %s import main\nsys.exit(main())\n' "$module" > "$entry"
    pyinstaller --onefile --name "$name" \
        --distpath "$TOOLS_DIR" \
        --workpath "$DTSCHEMA_DIR/.pyinstaller-build" \
        --specpath "$DTSCHEMA_DIR/.pyinstaller-build" \
        --collect-data dtschema \
        "$entry"
    runs "$TOOLS_DIR/$name" || { echo "$name does not run" >&2; exit 1; }
}

build_tool dt-mk-schema dtschema.mk_schema
build_tool dt-validate dtschema.dtb_validate

echo "==> Copying dt-schema schemas..."
rm -rf "$SCHEMA_DIR"
mkdir -p "$SCHEMA_DIR"
cp -r "$DTSCHEMA_DIR/dtschema" "$SCHEMA_DIR/dtschema"

deactivate

echo "==> Done. Bundled tools in $TOOLS_DIR, schemas in $SCHEMA_DIR"

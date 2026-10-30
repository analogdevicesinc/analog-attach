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
# The entry point of the bundled dt-mk-schema (it processes the bindings in parallel).
MK_SCHEMA_ENTRY="$SCRIPT_DIR/dt-mk-schema.py"
# Names this build: a change to the script or the entry point rebuilds the tools.
RECIPE_STAMP="$TOOLS_DIR/.recipe"
RECIPE="$(cat "$SCRIPT_DIR/bundle-dt-schema.sh" "$MK_SCHEMA_ENTRY" | sha256sum | cut -d' ' -f1)"

# A binary that prints no version never reached the tool's main().
runs() {
    [ -x "$1" ] && [ -n "$("$1" --version 2>/dev/null)" ]
}

already_built() {
    runs "$TOOLS_DIR/dt-mk-schema" && \
        runs "$TOOLS_DIR/dt-validate" && \
        [ -x "$TOOLS_DIR/dtc" ] && \
        [ -d "$SCHEMA_DIR/dtschema/schemas" ] && \
        [ "$(cat "$RECIPE_STAMP" 2>/dev/null)" = "$RECIPE" ] && \
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
# ruamel.yaml no longer pulls in its C loader, without which loading the
# bindings is most of dt-mk-schema's time.
pip install --quiet "$DTSCHEMA_DIR" ruamel.yaml.clib
python3 -c "import _ruamel_yaml" || { echo "ruamel.yaml.clib did not install" >&2; exit 1; }

# The dtschema modules have no __main__ block (pip reaches main() through
# entry points), so PyInstaller gets a script that calls it: dt-mk-schema's
# is scripts/dt-mk-schema.py, the others a small generated one.
build_tool() {
    local name="$1" entry="$2"
    echo "==> Building $name binary..."
    pyinstaller --onefile --name "$name" \
        --distpath "$TOOLS_DIR" \
        --workpath "$DTSCHEMA_DIR/.pyinstaller-build" \
        --specpath "$DTSCHEMA_DIR/.pyinstaller-build" \
        --collect-data dtschema \
        --hidden-import _ruamel_yaml \
        "$entry"
    runs "$TOOLS_DIR/$name" || { echo "$name does not run" >&2; exit 1; }
}

generated_entry() {
    local name="$1" module="$2"
    local entry="$DTSCHEMA_DIR/.pyinstaller-build/$name.py"
    mkdir -p "$(dirname "$entry")"
    printf 'import sys\nfrom %s import main\nsys.exit(main())\n' "$module" > "$entry"
    echo "$entry"
}

build_tool dt-mk-schema "$MK_SCHEMA_ENTRY"
build_tool dt-validate "$(generated_entry dt-validate dtschema.dtb_validate)"

echo "==> Copying dt-schema schemas..."
rm -rf "$SCHEMA_DIR"
mkdir -p "$SCHEMA_DIR"
cp -r "$DTSCHEMA_DIR/dtschema" "$SCHEMA_DIR/dtschema"

deactivate

echo "$RECIPE" > "$RECIPE_STAMP"

echo "==> Done. Bundled tools in $TOOLS_DIR, schemas in $SCHEMA_DIR"

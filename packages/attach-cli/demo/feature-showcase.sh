#!/usr/bin/env bash
set -euo pipefail

# Feature showcase demo for attach-linux
# Walks through everything delivered in the CLI findings work:
# env config (24), implicit workfile (2), naming (7-9,11,12), grammar (1,3,10,13,14,20),
# reg↔unit address (7,17), child nodes (R12), list (15,16), SPI filtering (21),
# interrupts (0,19), overlay syntax (6), validate2 (4,5), build.

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

PAUSE=true
[[ "${1:-}" == "--no-pause" ]] && PAUSE=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$PKG_DIR/dist/cli.js"
WORKSPACE="$PKG_DIR/.attach-linux"
SANDBOX="$SCRIPT_DIR/workspace"

step_num=0

step() {
    step_num=$((step_num + 1))
    local title="$1"; shift
    local desc="$1"; shift

    echo ""
    echo -e "${BOLD}${CYAN}[$step_num] $title${RESET}"
    echo -e "${DIM}$desc${RESET}"
    echo ""

    for cmd in "$@"; do
        echo -e "  ${YELLOW}\$ attach-linux ${cmd}${RESET}"
        eval "node \"$CLI\" $cmd" 2>&1 | sed 's/^/  /'
        echo ""
    done

    if $PAUSE; then
        echo -e "${DIM}  [press Enter]${RESET}"
        read -r
    fi
}

banner() {
    echo ""
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${GREEN}  $1${RESET}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# --- Prerequisites ---

for path in ~/rpi-4.dts ~/linux ~/dt-schema "$CLI"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done

if ! command -v dtc &>/dev/null; then
    echo -e "${RED}dtc not found on PATH${RESET}" >&2
    exit 1
fi

# Cached data for the sandbox
if [[ ! -f "$WORKSPACE/compat-index.json" ]]; then
    echo -e "${RED}Missing $WORKSPACE/compat-index.json — run a command first to build it${RESET}" >&2
    exit 1
fi

# --- Sandbox ---

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/.attach-linux"
cp "$WORKSPACE/compat-index.json" "$SANDBOX/.attach-linux/"
if [[ -f "$WORKSPACE/validation.json" ]]; then
    cp "$WORKSPACE/validation.json" "$SANDBOX/.attach-linux/"
    echo "validation-json = \"$SANDBOX/.attach-linux/validation.json\"" > "$SANDBOX/.attach-linux/config.toml"
fi
cd "$SANDBOX"

export ATTACH_LINUX=~/linux
export ATTACH_DT_SCHEMA=~/dt-schema
export ATTACH_CONTEXT=~/rpi-4.dts

banner "Feature Showcase — attach-linux CLI"
echo -e "  Target: Raspberry Pi 4 + Analog Devices AD7124-8 ADC on SPI0"
echo -e "  Sandbox: $SANDBOX"
echo ""

# ============================================================
# 1. Config (note 24)
# ============================================================
banner "1. Environment-variable config (note 24)"

step "Show config from env vars" \
    "ATTACH_LINUX, ATTACH_DT_SCHEMA, ATTACH_CONTEXT are read from the environment." \
    "config-get"

step "config-set linux refused" \
    "Environment fields cannot be set through config-set." \
    "config-set linux /tmp/linux || true"

# ============================================================
# 2. Implicit workfile (note 2)
# ============================================================
banner "2. Implicit workfile creation (note 2)"

step "add creates the workfile automatically" \
    "No overlay configured — add creates overlay.dtso, saves it to config, then adds the device." \
    "add adi,ad7124-8 --parent spi0"

step "Overlay content" \
    "The workfile was created with the device node." \
    "read"

# ============================================================
# 3. Naming (notes 7, 8, 9, 11, 12)
# ============================================================
banner "3. Naming, unit addresses and labels (notes 7-9, 11, 12)"

step "Auto unit address and label" \
    "The first add got @0 with reg = <0> and label ad7124_8. A second add gets @1." \
    "add adi,ad7124-8 --parent spi0"

step "Read both nodes" \
    "Two ad7124 nodes under spi0, each with its own reg and label." \
    "read spi0/adi,ad7124-8@2" \
    "read spi0/adi,ad7124-8@3"

step "Duplicate name refused" \
    "Adding the same explicit name twice is refused." \
    "add adi,ad7124-8 --parent spi0 --name adi,ad7124-8@2 || true"

step "Taken label refused" \
    "--label spi0 is already taken by the base tree." \
    "add adi,ad7124-8 --parent spi0 --label spi0 || true"

step "regulator-fixed at root: no unit address" \
    "A binding without reg gets no auto unit address, even under the root." \
    "add regulator-fixed"

step "Read the regulator" \
    "No @N, no reg — just the compatible." \
    "read regulator-fixed"

# ============================================================
# 4. Grammar (notes 1, 3, 10, 13, 14, 20)
# ============================================================
banner "4. New command grammar (notes 1, 3, 10, 13, 14, 20)"

step "update with new grammar" \
    "update <path> <property> <value...> — no --with." \
    "update spi0/adi,ad7124-8@2 spi-max-frequency 5000000"

step "read with path + property" \
    "read <path> <property> — no space-separated pathing." \
    "read spi0/adi,ad7124-8@2 spi-max-frequency"

step "No-value update on a flag" \
    "update <path> <property> with no value on a known flag → sets it." \
    "update spi0/adi,ad7124-8@2 spi-cpha"

step "No-value update on a value property" \
    "update <path> <property> with no value on a known non-flag → reads it." \
    "update spi0/adi,ad7124-8@2 spi-max-frequency"

step "Old --with syntax refused" \
    "The old syntax is rejected outright, no deprecation shim." \
    "update spi0/adi,ad7124-8@2 reg --with 0 || true"

step "rename <path> <new-name>" \
    "rename uses positionals, not --to." \
    "rename spi0/adi,ad7124-8@3 adc@3"

step "delete <path> <property>" \
    "delete flag property spi-cpha." \
    "delete spi0/adi,ad7124-8@2 spi-cpha"

# ============================================================
# 5. reg ↔ unit address (notes 7, 17)
# ============================================================
banner "5. reg ↔ unit address sync (notes 7, 17)"

step "rename changes reg" \
    "rename spi0/adc@3 to adc@5 → reg first cell becomes 5." \
    "rename spi0/adc@3 adc@5"

step "Read the renamed node" \
    "" \
    "read spi0/adc@5 reg"

# ============================================================
# 6. Child nodes via update (R12)
# ============================================================
banner "6. Child nodes via update (R12)"

step "Create channel@0" \
    "update <path> <child-node> creates the child and sets reg." \
    "update spi0/adi,ad7124-8@2 channel@0"

step "Create channel@1" \
    "" \
    "update spi0/adi,ad7124-8@2 channel@1"

step "Re-run reads the node" \
    "Running the same command again reads instead of creating." \
    "update spi0/adi,ad7124-8@2 channel@0"

# ============================================================
# 7. list (notes 15, 16)
# ============================================================
banner "7. list command (notes 15, 16)"

step "Bare list — catalogue" \
    "" \
    "list"

step "list device" \
    "Substring filter on compatible strings." \
    "list device ad7124"

step "list property" \
    "Properties of a node from its binding." \
    "list property spi0/adi,ad7124-8@2"

step "list parent" \
    "Valid parent buses for ad7124." \
    "list parent adi,ad7124-8"

# ============================================================
# 8. SPI filtering (note 21)
# ============================================================
banner "8. SPI vendor prop filtering (note 21)"

step "No vendor props on RPi spi0" \
    "list property on spi0/adi,ad7124-8@2 hides pl022, cdns, fsl, nvidia, st props." \
    "list property spi0/adi,ad7124-8@2"

# ============================================================
# 9. Interrupts (notes 0, 19)
# ============================================================
banner "9. Interrupts (notes 0, 19)"

step "Set interrupts — implicit interrupt-parent" \
    "Setting interrupts writes the inherited interrupt-parent = <&gicv2> automatically." \
    "update spi0/adi,ad7124-8@2 interrupts 19 2"

step "Read the node" \
    "interrupt-parent and interrupts are both present." \
    "read spi0/adi,ad7124-8@2"

# ============================================================
# 10. Overlay syntax (note 6)
# ============================================================
banner "10. Overlay syntax (note 6)"

step "Default fragment syntax" \
    "" \
    "read"

step "Switch to label syntax" \
    "config-set overlay-syntax label, then any write uses &label { }." \
    "config-set overlay-syntax label" \
    "update spi0/adi,ad7124-8@2 spi-max-frequency 5000000"

step "Label syntax output" \
    "" \
    "read"

step "Switch back to fragment" \
    "" \
    "config-set overlay-syntax fragment"

# ============================================================
# 11. validate2 (notes 4, 5)
# ============================================================
banner "11. Validation (notes 4, 5)"

step "validate2 — human-readable errors" \
    "Errors are grouped by fragment target, not nodeN." \
    "validate2"

# ============================================================
# 12. Build
# ============================================================
banner "12. Build"

step "build → .dtbo" \
    "Compile the overlay with dtc." \
    "build"

# ============================================================
# Summary
# ============================================================
banner "Done!"
echo ""
echo -e "  Notes covered: 0-17, 19-21, 24"
echo -e "  See SKILL.md for the full command reference."
echo ""
echo -e "  Commits:"
cd "$PKG_DIR"
git log --oneline 485cdde..HEAD | sed 's/^/    /'
echo ""

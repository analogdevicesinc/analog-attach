#!/usr/bin/env bash
set -euo pipefail

# Board-aware workflow demo for attach-linux
# Configures an AD7124-8 ADC on the PMD-RPI-INTZ HAT for a Raspberry Pi 4.

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

# --- Sandbox setup ---

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/.attach-linux"
cp "$WORKSPACE/compat-index.json" "$SANDBOX/.attach-linux/"
cp "$WORKSPACE/validation.json"   "$SANDBOX/.attach-linux/"
cd "$SANDBOX"

node "$CLI" config-set linux ~/linux           >/dev/null
node "$CLI" config-set dt-schema ~/dt-schema   >/dev/null
node "$CLI" config-set context ~/rpi-4.dts     >/dev/null
node "$CLI" config-set validationJson "$SANDBOX/.attach-linux/validation.json" >/dev/null

banner "Board-aware device tree overlay workflow"
echo ""
echo -e "  Target:  ${BOLD}AD7124-8${RESET} precision ADC (adi,ad7124-8)"
echo -e "  Board:   ${BOLD}PMD-RPI-INTZ${RESET} — Analog Devices HAT for Raspberry Pi 4"
echo -e "  Base DT: ${BOLD}rpi-4.dts${RESET}"
echo ""
echo -e "  ${DIM}This demo walks through configuring a peripheral from scratch,"
echo -e "  using the board-description intelligence layer to suggest"
echo -e "  concrete, hardware-correct values at every step.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Demo ---

step "Configure the board" \
    "A single name resolves to the bundled board description." \
    "config-set board pmd-rpi-intz" \
    "config-get board"

step "Discover physical slots" \
    "Which slots on this HAT can host an SPI ADC? Each row names a slot, its bus, chip select, and signals." \
    "suggest board-slot adi,ad7124-8"

step "Create the overlay and add the device" \
    "Picking spi_pmod1 — that's spi0 reg 0. The CLI adds the node to the overlay." \
    "create-workfile" \
    "add adi,ad7124-8 --to spi0 --label adc --name adc@0"

step "Suggest chip-select (reg) values" \
    "The board knows all 6 chip selects. Notice 'in use by spidev@0' — the base tree's default SPI device occupies CS0." \
    "suggest value adc/reg"

step "Disable spidev and re-check" \
    "After disabling spidev@0, the 'in use' annotation disappears. Sibling tracking works across overlay fragments." \
    "disable --node spidev0" \
    "suggest value adc/reg"

step "Set reg = 0" \
    "Write the chip select. Now the slot narrows to spi_pmod1." \
    "update adc/reg --with 0"

step "Suggest interrupts — before interrupt-parent" \
    "The board offers GPIO19 with every trigger type. But notice the annotation: the Pi's GIC is the inherited interrupt controller, not the GPIO block. The board layer catches this." \
    "suggest value adc/interrupts"

step "Set interrupt-parent and re-suggest" \
    "Labels resolve automatically — 'gpio' becomes <&gpio>. After setting it, the annotation disappears." \
    "update adc/interrupt-parent --with gpio" \
    "suggest value adc/interrupts"

step "Write interrupts in one step" \
    "Macros resolve to numbers: IRQ_TYPE_EDGE_FALLING becomes 2. No two-step workaround needed." \
    "update adc/interrupts --with '19 IRQ_TYPE_EDGE_FALLING'" \
    "read adc/interrupts"

step "Validate the overlay against dt-schema" \
    "dt-validate checks the overlay against the full device tree schema — no errors, no warnings." \
    "--json validate2 2>/dev/null | python3 -m json.tool"

step "The finished overlay" \
    "A complete, hardware-correct overlay — ready to build and deploy." \
    "read"

banner "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo -e "  Next:     ${DIM}validate, build, deploy${RESET}"
echo ""

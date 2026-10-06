#!/usr/bin/env bash
set -euo pipefail

# Board-aware workflow demo for attach-linux
# Configures an AD7124-8 ADC on SPI PMOD 1 of the PMD-RPI-INTZ HAT for a Raspberry Pi 4.

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

for tool in dtc dt-validate; do
    if ! command -v "$tool" >/dev/null; then
        echo -e "${RED}Missing prerequisite: $tool on PATH${RESET}" >&2
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
# validation-json is internal (not settable with config-set): point it at the
# copied bundle so validate2 doesn't regenerate it with dt-mk-schema.
echo "validation-json = \"$SANDBOX/.attach-linux/validation.json\"" >> "$SANDBOX/.attach-linux/config.toml"

banner "Board-aware device tree overlay workflow"
echo ""
echo -e "  Target:  ${BOLD}AD7124-8${RESET} precision ADC (adi,ad7124-8) on SPI PMOD 1"
echo -e "  Board:   ${BOLD}PMD-RPI-INTZ${RESET} — Analog Devices HAT for Raspberry Pi 4"
echo -e "  Base DT: ${BOLD}rpi-4.dts${RESET}"
echo ""
echo -e "  ${DIM}This demo walks through configuring a peripheral from scratch. At every"
echo -e "  step the tool says what is needed and suggests values: from the binding,"
echo -e "  from the context devicetree, and from the board's wiring.${RESET}"
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

step "Discover the board's slots" \
    "Each slot lists its bus, chip selects and signals. spi_pmod1 and quikeval (in SPI mode) share chip select GPIO8, so they exclude each other." \
    "suggest board-slot"

step "Create the workfile" \
    "This board ships no overlay of its own, so the workfile starts empty." \
    "create-workfile"

step "Which slots can host the ADC?" \
    "Only slots on an SPI bus. The ADC's Pmod is plugged into SPI PMOD 1, so spi_pmod1 it is: spi0, reg 0." \
    "suggest board-slot adi,ad7124-8"

step "Add the device" \
    "The CLI adds the node under spi0." \
    "add adi,ad7124-8 --to spi0 --label adc --name adc@0"

step "What does the binding expect?" \
    "Every property the AD7124-8 binding declares, required ones first, marked when already set. Only compatible is set so far; reg and interrupts are the remaining required ones. The last line lists the child nodes the binding allows: channel@N." \
    "suggest node-prop adc"

step "Suggest chip-select (reg) values" \
    "The board knows all 6 chip selects and who uses them. spi_pmod1 is reg 0, but the base tree's spidev@0 occupies it." \
    "suggest value adc/reg"

step "Free CS0 and set reg = 0" \
    "Disable spidev@0, then take the chip select. The board still lists quikeval next to spi_pmod1: both are wired to CS0, and only the user knows which one is populated (here, spi_pmod1)." \
    "disable --node spidev0" \
    "update adc/reg --with 0" \
    "suggest value adc/reg"

step "Suggest interrupts" \
    "The board offers GPIO19, spi_pmod1's interrupt pin, with every trigger type: the trigger depends on the device, not the board. The note flags that the node inherits the Pi's GIC as interrupt controller, but GPIO19 belongs to the GPIO block." \
    "suggest value adc/interrupts"

step "Point the interrupt at the GPIO controller" \
    "As the note asks, set interrupt-parent first. The board knows which controller its interrupt lines are on." \
    "suggest value adc/interrupt-parent" \
    "update adc/interrupt-parent --with gpio" \
    "suggest value adc/interrupts"

step "Choose the trigger type" \
    "The AD7124-8 pulls RDY low when a conversion is ready: the binding example and the Linux driver both use a falling edge. Macros resolve to numbers (IRQ_TYPE_EDGE_FALLING is 2)." \
    "update adc/interrupts --with 19 IRQ_TYPE_EDGE_FALLING" \
    "read adc/interrupts"

step "A recommended GPIO: rdy-gpios" \
    "Not required, but the binding highly recommends it: DOUT/RDY also toggles during SPI transfers, and reading the line is how the driver tells a real interrupt from a spurious one. On spi_pmod1 it is the same GPIO19; quikeval's GPIO22 is listed because it shares CS0. RDY is active low." \
    "suggest value adc/rdy-gpios" \
    "update adc/rdy-gpios --with gpio 19 GPIO_ACTIVE_LOW"

step "An optional external reference" \
    "refin1-supply is optional: without it the ADC uses its internal 2.5 V reference. The context devicetree offers its regulators, but each is only right if it actually feeds REFIN1, so nothing is set here." \
    "suggest value adc/refin1-supply"

step "Child nodes need address cells" \
    "The last line of node-prop showed that the binding allows channel@N child nodes. Their unit addresses need #address-cells and #size-cells on the ADC, and the binding pins both." \
    "suggest value adc/#address-cells" \
    "update adc/#address-cells --with 1" \
    "suggest value adc/#size-cells" \
    "update adc/#size-cells --with 0"

step "Add two channels" \
    "Each channel node is a bare subnode (no compatible). node-prop on a channel shows what its pattern requires: reg and diff-channels." \
    "add --name channel@0 --to adc" \
    "add --name channel@1 --to adc" \
    "suggest node-prop adc/channel@0"

step "Channel reg" \
    "By devicetree convention reg matches the unit address, so the tool suggests it from the node name." \
    "suggest value adc/channel@0/reg" \
    "update adc/channel@0/reg --with 0" \
    "suggest value adc/channel@1/reg" \
    "update adc/channel@1/reg --with 1"

step "Differential inputs against ground" \
    "diff-channels is a pair of analog inputs, positive then negative. Which pins the signals are wired to is up to the user, so nothing suggests a value. The AD7124 encodes AVSS (ground) as input 17 (datasheet; AD7124_CHANNEL_AINx_AVSS in the driver): channel 0 measures AIN0 against ground, channel 1 AIN1." \
    "suggest type adc/channel@0/diff-channels" \
    "update adc/channel@0/diff-channels --with 0 17" \
    "update adc/channel@1/diff-channels --with 1 17"

step "Check the required properties" \
    "Every required property is now set, and both channels are present (last line)." \
    "suggest node-prop adc" \
    "suggest node-prop adc/channel@1"

step "Validate against dt-schema" \
    "dt-validate checks the overlay against the full device tree schema — no errors, no warnings." \
    "--json validate2 2>/dev/null | python3 -m json.tool"

step "Build" \
    "dtc compiles the workfile." \
    "build" \
    "read adc"

banner "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo -e "  Next:     ${DIM}deploy${RESET}"
echo ""

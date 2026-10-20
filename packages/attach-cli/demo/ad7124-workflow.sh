#!/usr/bin/env bash
set -euo pipefail

# Single-device workflow demo for attach-linux
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

for path in ~/rpi-4.dts ~/linux "$CLI"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done

# --- Sandbox setup ---

# Reuse the package workspace's caches when it has them; the CLI rebuilds
# whatever is missing (validation.json takes about a minute).
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/.attach-linux"
for cache in compat-index.json validation.json validation.stamp.json; do
    if [[ -f "$WORKSPACE/$cache" ]]; then
        cp "$WORKSPACE/$cache" "$SANDBOX/.attach-linux/"
    fi
done

export ATTACH_LINUX=~/linux
export ATTACH_DEVICETREE=~/rpi-4.dts

cd "$SANDBOX"

banner "Device tree overlay workflow"
echo ""
echo -e "  Target:  ${BOLD}AD7124-8${RESET} precision ADC (adi,ad7124-8) on SPI PMOD 1"
echo -e "  Board:   ${BOLD}PMD-RPI-INTZ${RESET} — Analog Devices HAT for Raspberry Pi 4"
echo -e "  Base DT: ${BOLD}rpi-4.dts${RESET}"
echo ""
echo -e "  ${DIM}This demo walks through configuring a peripheral from scratch. At every"
echo -e "  step the tool says what is needed and suggests values from the binding"
echo -e "  and the base devicetree. How the HAT is wired is up to the user.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Demo ---

step "Create the workfile" \
    "The workfile starts empty; create-workfile saves its path to the config." \
    "create-workfile"

step "Which buses can host the ADC?" \
    "Every SPI controller in the base tree. On the HAT, SPI PMOD 1 is wired to spi0, chip select 0." \
    "list parent adi,ad7124-8"

step "Add the device" \
    "The CLI adds the node under spi0." \
    "add adi,ad7124-8 --parent spi0 --label adc --name adc@0"

step "What does the binding expect?" \
    "Every property the AD7124-8 binding declares, required ones first, marked when already set. add set reg from the unit address, so interrupts is the remaining required one. The last line lists the child nodes the binding allows: channel@N." \
    "list property adc"

step "Chip select (reg)" \
    "reg follows the unit address: chip select 0, where SPI PMOD 1 is wired." \
    "list value adc reg"

step "Free CS0" \
    "The base tree's spidev@0 also sits on chip select 0. Disable it so the ADC owns the line." \
    "disable spidev0"

step "Point the interrupt at the GPIO controller" \
    "On SPI PMOD 1, RDY goes to GPIO19. Left alone, the node inherits the Pi's GIC as interrupt controller, but GPIO19 belongs to the GPIO block. list value offers both controllers with their cell counts; set interrupt-parent before interrupts." \
    "list value adc interrupt-parent" \
    "update adc interrupt-parent gpio"

step "Choose the trigger type" \
    "The AD7124-8 pulls RDY low when a conversion is ready: the binding example and the Linux driver both use a falling edge. Macros resolve to numbers (IRQ_TYPE_EDGE_FALLING is 2). read shows the value with the binding's description." \
    "update adc interrupts 19 IRQ_TYPE_EDGE_FALLING" \
    "read adc interrupts"

step "A recommended GPIO: rdy-gpios" \
    "Not required, but the binding highly recommends it: DOUT/RDY also toggles during SPI transfers, and reading the line is how the driver tells a real interrupt from a spurious one. On SPI PMOD 1 it is the same GPIO19 as the interrupt. RDY is active low." \
    "update adc rdy-gpios gpio 19 GPIO_ACTIVE_LOW"

step "An optional external reference" \
    "refin1-supply is optional: without it the ADC uses its internal 2.5 V reference. The base devicetree offers its regulators, but each is only right if it actually feeds REFIN1, so nothing is set here." \
    "list value adc refin1-supply"

step "Child nodes need address cells" \
    "The last line of list property showed that the binding allows channel@N child nodes. Their unit addresses need #address-cells and #size-cells on the ADC, and the binding pins both." \
    "list value adc '#address-cells'" \
    "update adc '#address-cells' 1" \
    "list value adc '#size-cells'" \
    "update adc '#size-cells' 0"

step "Add two channels" \
    "Each channel node is created through update. list property on a channel shows what its pattern requires: reg and diff-channels." \
    "update adc channel@0" \
    "update adc channel@1" \
    "list property adc/channel@0"

step "Channel reg" \
    "By devicetree convention reg matches the unit address, so the tool suggests it from the node name." \
    "list value adc/channel@0 reg" \
    "update adc/channel@0 reg 0" \
    "list value adc/channel@1 reg" \
    "update adc/channel@1 reg 1"

step "Differential inputs against ground" \
    "diff-channels is a pair of analog inputs, positive then negative. Which pins the signals are wired to is up to the user, so nothing suggests a value. The AD7124 encodes AVSS (ground) as input 17 (datasheet; AD7124_CHANNEL_AINx_AVSS in the driver): channel 0 measures AIN0 against ground, channel 1 AIN1." \
    "list property adc/channel@0 diff-channels" \
    "update adc/channel@0 diff-channels 0 17" \
    "update adc/channel@1 diff-channels 1 17"

step "Check the required properties" \
    "Every required property is now set, and both channels are present (last line)." \
    "list property adc" \
    "list property adc/channel@1"

step "Validate against dt-schema" \
    "dt-validate checks the overlay against the full device tree schema — no errors, no warnings." \
    "--json validate 2>/dev/null | python3 -m json.tool"

step "Build" \
    "dtc compiles the workfile." \
    "build" \
    "read adc"

banner "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo -e "  Next:     ${DIM}deploy${RESET}"
echo ""

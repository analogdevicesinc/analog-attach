#!/usr/bin/env bash
set -euo pipefail

# Board-overlay workflow demo for attach-linux
# Adds an AD7768-1 ADC on the SPI Pmod of the ADALM-LSMSPG board for a Raspberry Pi 4.
# The board ships its own overlay (AD5592R, AD5593R, LM75, one-bit-adc-dac); the
# workfile starts from it.

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
for tool in cpp dtc dt-validate; do
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

banner "Board with onboard devices: start from the board's overlay"
echo ""
echo -e "  Target:  ${BOLD}AD7768-1${RESET} 24-bit ADC (adi,ad7768-1) on the SPI Pmod"
echo -e "  Board:   ${BOLD}ADALM-LSMSPG${RESET} — onboard AD5592R, AD5593R, LM75 + Pmod connectors"
echo -e "  Base DT: ${BOLD}rpi-4.dts${RESET}"
echo ""
echo -e "  ${DIM}This board ships an overlay for its soldered-on devices. The workfile"
echo -e "  starts from it, and the board layer knows which chip selects and lines"
echo -e "  those devices, jumpers and shared Pmod pins already take.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Demo ---

step "Configure the board" \
    "A single name resolves to the bundled board description, which also names the board's overlay." \
    "config-set board adalm-lsmspg" \
    "config-get board"

step "Discover the board's slots" \
    "Only the free slots are listed; the onboard devices occupy theirs. Each Pmod lists every line, including jumper alternatives open by default (P11, P14, P36, P37)." \
    "suggest board-slot"

step "Start from the board's overlay" \
    "create-workfile writes the board's overlay instead of an empty one: run through the C preprocessor against the Linux tree (#include + CH_MODE_* macros), with the Pi firmware's __overrides__ dropped. The preprocess command is saved to the config." \
    "create-workfile" \
    "config-get preprocess-command"

step "The onboard devices are already there" \
    "Macros are resolved to numbers (CH_MODE_DAC → 2), so the workfile compiles with plain dtc." \
    "read ad5592r" \
    "read lm75"

step "Which slot can host the ADC?" \
    "Only the SPI Pmod: the onboard AD5592R occupies spi0 reg 0." \
    "suggest board-slot adi,ad7768-1"

step "Add the device" \
    "The node has no reg yet, but the onboard slot is out of the running, so the board layer already narrows to spi_pmod." \
    "add adi,ad7768-1 --to spi0 --label adc --name adc@1"

step "What does the binding expect?" \
    "Every property the AD7768-1 binding declares, required ones first, marked when already set. Only compatible is set so far; the rest of the required list (reg, clocks, clock-names, vref-supply, spi-cpol, spi-cpha) is what the next steps fill in. The last line lists the child nodes the binding allows: channel@N." \
    "suggest node-prop adc"

step "Suggest chip-select (reg) values" \
    "reg 0 is taken by the onboard AD5592R (from the board overlay), reg 1 by the base tree's spidev@1. Jumper P11 would route the Pmod's CS to GPIO27 instead of GPIO7: the reg stays 1." \
    "suggest value adc/reg"

step "Free CS1 and set reg = 1" \
    "The board overlay only disables spidev0; CE1 still has a spidev. Disable it and take the Pmod's chip select." \
    "disable --node spidev1" \
    "update adc/reg --with 1" \
    "suggest value adc/reg"

step "Suggest interrupts" \
    "The board offers GPIO19, the Pmod's interrupt pin (P13 fitted), with every trigger type: the trigger depends on the device, not the board. The notes flag two things: the node inherits the Pi's GIC as interrupt controller, but GPIO19 belongs to the GPIO block; and with P37 fitted the same GPIO would also reach the I2C Pmod." \
    "suggest value adc/interrupts"

step "Point the interrupt at the GPIO controller" \
    "As the note asks, set interrupt-parent first. The board knows which controller its interrupt lines are on." \
    "suggest value adc/interrupt-parent" \
    "update adc/interrupt-parent --with gpio" \
    "suggest value adc/interrupts"

step "Choose the trigger type" \
    "The AD7768-1 raises DRDY when a conversion is ready: the binding example and the Linux driver both use a rising edge." \
    "update adc/interrupts --with '19 IRQ_TYPE_EDGE_RISING'" \
    "read adc/interrupts"

step "A reset line shared by both Pmods" \
    "GPIO26 is hard-wired to the RESET pin of both Pmods. Both slots stay usable, but asserting the reset resets both devices. The AD7768-1's RESET is active low, as in the binding example." \
    "suggest value adc/reset-gpios" \
    "update adc/reset-gpios --with 'gpio 26 GPIO_ACTIVE_LOW'"

step "Required properties fixed by the binding" \
    "No need to read the binding: suggest value offers what the AD7768-1 binding pins (a const clock-names, required SPI mode flags). Each one is then set exactly as suggested." \
    "suggest value adc/clock-names" \
    "update adc/clock-names --with mclk" \
    "suggest value adc/spi-cpol" \
    "update adc/spi-cpol --with true" \
    "suggest value adc/spi-cpha" \
    "update adc/spi-cpha --with true"

step "Required properties that describe external hardware" \
    "The binding also requires a master clock and a reference supply. The board says nothing about them, but the context devicetree has fixed clocks and regulators, offered with their frequency and voltage. Each is only right if it is actually wired to the ADC; the demo picks clk_osc and vdd_3v3_reg just to complete the tree. A real setup describes the clock and reference physically hooked up (e.g. a fixed-clock and a fixed-regulator node) and references those." \
    "suggest value adc/clocks" \
    "update adc/clocks --with clk_osc" \
    "suggest value adc/vref-supply" \
    "update adc/vref-supply --with vdd_3v3_reg"

step "Child nodes need address cells" \
    "The last line of node-prop showed that the binding allows channel@N child nodes. Their unit addresses need #address-cells and #size-cells on the ADC, and the binding pins both." \
    "suggest value adc/#address-cells" \
    "update adc/#address-cells --with 1" \
    "suggest value adc/#size-cells" \
    "update adc/#size-cells --with 0"

step "Add two channels" \
    "Each channel node is a bare subnode (no compatible); its pattern only requires reg. The AD7768-1 has a single analog input: a second channel validates, but the driver only uses channel 0." \
    "add --name channel@0 --to adc" \
    "add --name channel@1 --to adc" \
    "suggest node-prop adc/channel@0"

step "Channel reg" \
    "By devicetree convention reg matches the unit address, so the tool suggests it from the node name." \
    "suggest value adc/channel@0/reg" \
    "update adc/channel@0/reg --with 0" \
    "suggest value adc/channel@1/reg" \
    "update adc/channel@1/reg --with 1"

step "Check the required properties" \
    "Every required property is now set, and both channels are present (last line)." \
    "suggest node-prop adc"

step "Validate against dt-schema" \
    "The ADC is clean. dt-validate also checks the onboard devices from the vendor overlay, and catches a 'label' property their bindings don't allow." \
    "--json validate2 2>/dev/null | python3 -m json.tool"

step "Fix the vendor overlay and re-validate" \
    "The workfile is a normal overlay: edit the onboard nodes like any other. Note: the label isn't pointless. The IIO core reads it as the device's sysfs label (industrialio-core.c), and the vendor overlay sets names like my_lsmspg_ad5592r on purpose. The real gap is upstream: adi,ad5592r.yaml (which also covers the AD5593R) never declares label, so its additionalProperties: false rejects it. A one-line 'label: true' there would make the overlay valid; deleting it here gets a clean tree but loses those names." \
    "delete ad5592r/label" \
    "delete ad5593r/label" \
    "--json validate2 2>/dev/null | python3 -m json.tool"

step "Build" \
    "dtc compiles the workfile, onboard devices and the new ADC together." \
    "build" \
    "read adc"

banner "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo -e "  Next:     ${DIM}deploy${RESET}"
echo ""

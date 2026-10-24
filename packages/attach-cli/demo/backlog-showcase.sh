#!/usr/bin/env bash
set -euo pipefail

# Showcase of the backlog features: index progress, the interview after add
# and for a new channel, verbose read, reg clashes, binding patterns,
# add --from-example, and list overlay / import. Raspberry Pi 4 base; the
# overlay part uses the ADI Linux tree, which carries the RPi overlays.

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

pause() {
    if $PAUSE; then
        echo -e "${DIM}  [press Enter]${RESET}"
        read -r
    fi
}

heading() {
    step_num=$((step_num + 1))
    echo ""
    echo -e "${BOLD}${CYAN}[$step_num] $1${RESET}"
    echo -e "${DIM}$2${RESET}"
    echo ""
}

step() {
    local title="$1"; shift
    local desc="$1"; shift
    heading "$title" "$desc"

    for cmd in "$@"; do
        echo -e "  ${YELLOW}\$ attach-linux ${cmd}${RESET}"
        eval "node \"$CLI\" $cmd" 2>&1 | sed 's/^/  /'
        echo ""
    done
    pause
}

# A command run on a terminal (a pty), with the answers typed one per prompt.
tty_step() {
    local title="$1"; shift
    local desc="$1"; shift
    local answers="$1"; shift
    heading "$title" "$desc"

    echo -e "  ${YELLOW}\$ attach-linux $*${RESET}"
    { sleep 2; while IFS= read -r line; do printf '%s\r' "$line"; sleep 1.5; done <<< "$answers"; sleep 2; } \
        | script -qec "node \"$CLI\" $*" /dev/null 2>&1 | sed 's/\r//g; s/\x1b\[[0-9;]*[A-Za-z]//g; s/^/  /'
    echo ""
    pause
}

# Shell completion: the candidates a <TAB> after the words would offer.
complete_step() {
    local title="$1"; shift
    local desc="$1"; shift
    heading "$title" "$desc"

    for words in "$@"; do
        echo -e "  ${YELLOW}\$ attach-linux ${words} <TAB>${RESET}"
        eval "node \"$CLI\" __complete -- $words" 2>&1 | sed 's/^__ATTACH_COMPLETE_NOSPACE__$/(no trailing space)/; s/^__ATTACH_COMPLETE_GROUP__\t\(.*\)/[\1]/; s/\t/  — /; s/^/  /'
        echo ""
    done
    pause
}

banner() {
    echo ""
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${GREEN}  $1${RESET}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# --- Prerequisites ---

for path in ~/rpi-4.dts ~/linux ~/linux_adi "$CLI"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done
if ! command -v script >/dev/null; then
    echo -e "${RED}Missing prerequisite: script (util-linux), to run the interview on a pty${RESET}" >&2
    exit 1
fi

# --- Sandbox setup ---

# The compat index is left out on purpose: the first step builds it. The
# validation schemas are reused when the package workspace has them.
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/rpi/.attach-linux" "$SANDBOX/adi"
for cache in validation.json validation.stamp.json; do
    if [[ -f "$WORKSPACE/$cache" ]]; then
        cp "$WORKSPACE/$cache" "$SANDBOX/rpi/.attach-linux/"
    fi
done

export ATTACH_LINUX=~/linux
export ATTACH_DEVICETREE=~/rpi-4.dts

cd "$SANDBOX/rpi"

banner "attach-linux: what's new"
echo ""
echo -e "  Base DT: ${BOLD}rpi-4.dts${RESET} (Raspberry Pi 4)"
echo -e "  Linux:   ${BOLD}~/linux${RESET}, then ${BOLD}~/linux_adi${RESET} for its RPi overlays"
echo ""
echo -e "  ${DIM}Each step shows one feature: index progress, the interview after add"
echo -e "  and for a new channel, verbose read, reg clashes, binding patterns,"
echo -e "  add --from-example, and starting from an overlay that already exists.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Demo ---

step "The compat index says what it is doing" \
    "No index yet: the first lookup builds it and says why, with a counter on a terminal and the time it took. Later runs reuse it until a binding changes." \
    "list device ad7124" \
    "list device ad7124"

tty_step "add picks a chip select, then asks for what is missing" \
    "spidev@0 and spidev@1 hold chip selects 0 and 1, so add picks 2 and says why. On a terminal it then asks for each required property, interrupt-parent before interrupts, with the binding's description and suggestions. Here: gpio, then GPIO19 on a falling edge." \
    $'gpio\n19 IRQ_TYPE_EDGE_FALLING' \
    add adi,ad7124-8 --parent spi0 --label adc

tty_step "A new channel asks for what it needs" \
    "update <node> <child> creates a child node the binding allows, with reg from the unit address (decimal, as the binding names channels). A channel has required properties of its own, so they are asked for the same way. Here: AIN0 against AIN1." \
    '0 1' \
    update adc channel@0

step "read explains what it shows" \
    "A property comes with its binding description, the allowed values and the suggestions. A phandle has no allowed list: the disabled nodes it could name come after the suggestions. --quiet gives the bare DTS. (A node read lists the required properties it still lacks: step 10.)" \
    "read adc interrupt-parent" \
    "read adc interrupt-parent --quiet"

step "A chip select that is taken" \
    "Moving the ADC to chip select 0 renames the node and warns right away: spidev@0 is there. validate reports the clash with the dt-schema results, with the fix." \
    "update adc reg 0" \
    "validate"

step "Free the chip select" \
    "Disabling the base spidev@0 clears the clash." \
    "disable spidev0" \
    "validate"

step "Names from binding patterns" \
    "The ADT7475 binding names some properties by a regex (^adi,bypass-attenuator-in[0-4]\$). list property shows the names each pattern matches, and which are set." \
    "add adi,adt7475 --parent i2c1 --name hwmon@2e --label hwmon --quiet" \
    "update hwmon adi,bypass-attenuator-in1 1" \
    "list property hwmon"

complete_step "Completion knows the patterns" \
    "Completion lists what the node has, then what it could have: the properties not set yet and the names the patterns allow. An unbounded pattern completes its stem, with no trailing space." \
    "update hwmon adi,bypass" \
    "update hwmon fa"

step "Copy the binding's example" \
    "--from-example copies the node from the binding's example for the bus: name, reg, channels and references as written. The example is for the AD7124-4, so the compatible is replaced. Its references that name nothing in the base come back as errors, with the fix." \
    "add adi,ad7124-8 --parent spi1 --from-example --quiet" \
    "read ad7124_8 --quiet"

step "Add the missing reference" \
    "A fixed regulator labelled adc_vref resolves the reference. read on the new node lists the required property it still lacks." \
    "add regulator-fixed --label adc_vref --quiet" \
    "read adc_vref" \
    "update adc_vref regulator-name vref" \
    "validate"

# --- Existing overlays (ADI tree) ---

banner "Start from an overlay in the Linux tree"
export ATTACH_LINUX=~/linux_adi
cd "$SANDBOX/adi"

step "Which overlays already add the device?" \
    "The overlays of the Linux tree are indexed on first use. Each one's root compatible is compared with the base: brcm,bcm2835 means any Pi, so it fits a Pi 4. A Pi 5-only overlay does not." \
    "list overlay adi,ad7124-4" \
    "list overlay sony,imx500"

step "Import one" \
    "import brings in every fragment as written (the regulator, the ADC on spi0, the spidevs it replaces) into a new workfile named after the overlay, and makes it the configured overlay. A second import switches to its own workfile and keeps the first, with the command to switch back." \
    "import rpi-ad7124-8-all-diff-overlay.dts" \
    "import rpi-ad7124-overlay.dts" \
    "read spi0/adc@0 refin1-supply --quiet" \
    "read spidev0 status --quiet"

step "Validate the imported overlay" \
    "The validation schemas for this tree are compiled on first use, with the same progress lines as the index." \
    "validate"

# A second workspace, so nothing is configured yet; the overlay index is shared.
mkdir -p "$SANDBOX/adi-pi5/.attach-linux"
cp "$SANDBOX/adi/.attach-linux/overlay-index.json" "$SANDBOX/adi-pi5/.attach-linux/"
cd "$SANDBOX/adi-pi5"

step "Import from another board" \
    "A Pi 5 overlay on the Pi 4 (new workspace): import warns about the board and about each reference the base lacks, with the label-first path to fix it." \
    "import imx500-pi5-overlay.dts"

banner "Done"
echo ""
echo -e "  Workspaces: ${BOLD}$SANDBOX/rpi${RESET}, ${BOLD}$SANDBOX/adi${RESET}, ${BOLD}$SANDBOX/adi-pi5${RESET}"
echo ""

#!/usr/bin/env bash
set -euo pipefail

# A typical analog-attach session with the linux backend: an AD7124-8 ADC on
# SPI PMOD 1 of the PMD-RPI-INTZ HAT for a Raspberry Pi 4, from an empty
# workspace to a built overlay, with the wrong turns a user takes on the way and
# how the CLI's own output gets them back on track.
#
# Usage: demo/typical-flow.sh [--no-pause]
#
# Needs a Raspberry Pi Linux tree at ~/linux_rpi and the built CLI
# (yarn workspace @analog-attach/cli build). The workspace is demo/workspace/,
# or DEMO_WORKSPACE; it is emptied first.

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
SANDBOX="${DEMO_WORKSPACE:-$SCRIPT_DIR/workspace}"
LINUX="$HOME/linux_rpi"
BASE="$LINUX/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"

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

# A step of commands run as they are (piped: nothing is asked).
step() {
    local title="$1"; shift
    local desc="$1"; shift
    heading "$title" "$desc"

    for cmd in "$@"; do
        echo -e "  ${YELLOW}\$ analog-attach ${cmd}${RESET}"
        eval "node \"$CLI\" $cmd" 2>&1 | sed 's/^/  /'
        echo ""
    done
    pause
}

# A step run on a pty, so the CLI asks; the answers are typed one per line
# (an empty line is Enter).
tty_step() {
    local title="$1"; shift
    local desc="$1"; shift
    local answers="$1"; shift
    heading "$title" "$desc"

    echo -e "  ${YELLOW}\$ analog-attach $*${RESET}"
    { sleep 2; while IFS= read -r line; do printf '%s\r' "$line"; sleep 1.5; done <<< "$answers"; sleep 2; } \
        | script -qec "node \"$CLI\" $*" /dev/null 2>&1 | sed 's/\r//g; s/\x1b\[[0-9;]*[A-Za-z]//g; s/^/  /'
    echo ""
    pause
}

banner() {
    echo ""
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${GREEN}  $1${RESET}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# --- Prerequisites ---

for path in "$LINUX" "$BASE" "$CLI"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done
if ! command -v script >/dev/null; then
    echo -e "${RED}Missing prerequisite: script (util-linux), to run the interview on a pty${RESET}" >&2
    exit 1
fi

# --- Sandbox: empty, so config linux builds the binding caches ---

if [[ -d "$SANDBOX" && -n "$(ls -A "$SANDBOX")" && ! -d "$SANDBOX/.analog-attach" ]]; then
    echo -e "${RED}$SANDBOX is not empty and is not a workspace: not emptying it${RESET}" >&2
    exit 1
fi
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

banner "analog-attach: a typical Linux session"
echo ""
echo -e "  Target:  ${BOLD}AD7124-8${RESET} precision ADC (adi,ad7124-8) on SPI PMOD 1"
echo -e "  Board:   ${BOLD}PMD-RPI-INTZ${RESET} — Analog Devices HAT for Raspberry Pi 4"
echo -e "  Base DT: ${BOLD}bcm2711-rpi-4-b.dts${RESET}, bindings from ${BOLD}$LINUX${RESET}"
echo ""
echo -e "  ${DIM}From an empty workspace to a built overlay. A few answers are wrong on"
echo -e "  purpose: each time, what the CLI prints says how to fix it.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Set up and find the device ---

step "Set up the workspace" \
    "config saves the backend, the Linux tree, the base devicetree and the workfile's name to .analog-attach/config.json (backend at the top, the rest in its "linux" section); setting linux builds the binding caches (about a minute, once per Linux tree). init then creates the empty workfile overlay.dtso. (On a terminal, a bare analog-attach asks for all of them, saves them and runs init.)" \
    "config backend linux" \
    "config linux $LINUX" \
    "config devicetree $BASE" \
    "config workfile overlay.dtso" \
    "init"

step "Find the device" \
    "The compatibles of the Linux tree's bindings that match the filter." \
    "list devices ad7124"

step "Where can it go?" \
    "The ADC is an SPI device, so every SPI controller of the base tree can host it. On the HAT, SPI PMOD 1 is wired to spi0 (labelled spi here), chip select 0." \
    "list parent adi,ad7124-8"

# --- Add it ---

tty_step "Add the ADC" \
    "On a terminal add asks where the node goes (Enter takes spi), takes spi-max-frequency from the binding's example, then asks for each required property. RDY is wired to GPIO19, so interrupt-parent is gpio. Wrong turn: GPIO19 is the pin's name, but interrupts wants the line number on that controller. It is refused and asked again, before the trigger type: 19, falling edge." \
    $'\nb\nGPIO19\n19\nc' \
    add adi,ad7124-8 --label adc

step "Wrong chip select" \
    "add picked chip select 2, the first free one, and warned that spi0 has no cs-gpios entry for it. The ADC is wired to chip select 0: rename sets reg to match. That warns again: the base tree's spidev@0 is on chip select 0, with the fix. Disabling it is written to the overlay; the base tree is never changed." \
    "rename adc adc@0" \
    "disable spidev0"

# --- Channels ---

tty_step "Channel 0" \
    "update <node> <child> creates a child node the binding allows, with reg from the unit address, and asks for the child's required properties. The #address-cells and #size-cells a child needs go on the ADC too (see read at the end). diff-channels is a positive and a negative input: AIN0 against AVSS, which the AD7124 numbers 17." \
    $'0\n17' \
    update adc channel@0

step "Channel 1, without the questions" \
    "--quiet creates the child and lists what it misses instead of asking; update sets it. AIN1 against AVSS." \
    "update adc channel@1 --quiet" \
    "update adc/channel@1 diff-channels 1 17"

# --- Validate ---

step "Wrong reference" \
    "Wrong turn: the user wants the internal reference on channel 0 and guesses adi,reference-select 2. update writes it (the binding shapes a value, it never refuses it); validate checks the overlay with dt-validate and reports it." \
    "update adc/channel@0 adi,reference-select 2" \
    "validate"

step "Read the binding, fix it" \
    "The binding says what each value means, and that the internal reference is what you get when the property is left out. So delete it, and validate again." \
    "list property adc/channel@0 adi,reference-select" \
    "delete adc/channel@0 adi,reference-select" \
    "validate"

# --- Build ---

step "Build" \
    "dtc compiles the workfile into overlay.dtbo. read shows the finished node." \
    "build" \
    "read adc"

banner "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo -e "  Next:     ${DIM}deploy (after config deploy-ip, deploy-user and deploy-password)${RESET}"
echo ""

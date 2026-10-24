#!/usr/bin/env bash
set -euo pipefail

# Showcase of the notes_1 round, on a Raspberry Pi 4 with ADI parts:
#   init (wizard with the live .dts filter, flags, --json), the parent question,
#   the interview's automatic fills (pinned values, example values, if/then),
#   lettered picks and --quiet, GPIO rows, add --template, list overlay.
# Steps marked "your turn" run on the terminal and wait for your answers;
# the hint under the title says what to type.

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
MAGENTA='\033[35m'
RED='\033[31m'
RESET='\033[0m'

PAUSE=true
[[ "${1:-}" == "--no-pause" ]] && PAUSE=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$PKG_DIR/dist/cli.js"
LINUX=~/linux_adi
DTS="$LINUX/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"
# Binding caches built for $LINUX; without them init builds them (about 80 s).
CACHES="$PKG_DIR/plans/e2e/n1-base/.attach-linux"
SANDBOX="$SCRIPT_DIR/workspace/notes1"

step_num=0

header() {
    step_num=$((step_num + 1))
    echo ""
    echo -e "${BOLD}${CYAN}[$step_num] $1${RESET}"
    echo -e "${DIM}$2${RESET}"
    echo ""
}

pause() {
    if $PAUSE; then
        echo -e "${DIM}  [press Enter]${RESET}"
        read -r
    fi
}

# A step that only shows output: step <title> <description> <command>...
step() {
    local title="$1"; shift
    local desc="$1"; shift
    header "$title" "$desc"
    for cmd in "$@"; do
        echo -e "  ${YELLOW}\$ attach-linux ${cmd}${RESET}"
        eval "node \"$CLI\" $cmd" 2>&1 | sed 's/^/  /' || true
        echo ""
    done
    pause
}

# A step you answer: live <title> <description> <hint> <command>. It runs on the terminal itself, so the CLI asks.
live() {
    local title="$1" desc="$2" hint="$3" cmd="$4"
    header "$title  ${MAGENTA}(your turn)${RESET}${BOLD}${CYAN}" "$desc"
    echo -e "  ${MAGENTA}Type:${RESET} $hint"
    echo ""
    echo -e "  ${YELLOW}\$ attach-linux ${cmd}${RESET}"
    eval "node \"$CLI\" $cmd" || true
    echo ""
    pause
}

chapter() {
    echo ""
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}${GREEN}  $1${RESET}"
    echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# --- Prerequisites ---

for path in "$LINUX" "$DTS" "$CLI"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done
if [[ ! -t 0 || ! -t 1 ]]; then
    echo -e "${RED}Run this on a terminal: the wizard and the interviews only ask there.${RESET}" >&2
    exit 1
fi

# --- Sandbox setup ---

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/.attach-linux"
for cache in compat-index.json validation.json validation.stamp.json; do
    if [[ -f "$CACHES/$cache" ]]; then
        cp "$CACHES/$cache" "$SANDBOX/.attach-linux/"
    fi
done
cd "$SANDBOX"

chapter "attach-linux: what the notes_1 round added"
echo ""
echo -e "  Board:    ${BOLD}Raspberry Pi 4 B${RESET} (bcm2711-rpi-4-b.dts from $LINUX)"
echo -e "  Devices:  ${BOLD}AD5592R${RESET} DAC, ${BOLD}ADXL345${RESET} accelerometer, ${BOLD}AD7124-8${RESET} ADC, ${BOLD}HMC425A${RESET} attenuator"
echo -e "  Sandbox:  ${DIM}$SANDBOX${RESET}"
echo ""
echo -e "  ${DIM}Steps marked (your turn) wait for your answers; the Type: line says what"
echo -e "  to enter. Anything else works too: a wrong answer is asked again, - skips"
echo -e "  a question, Ctrl-D stops an interview.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- init ---

chapter "1. init: one command sets up the workspace"

live "The wizard" \
    "A bare 'attach-linux' on a terminal is 'attach-linux init'. Step 1 lists the Linux trees found under ~ (any directory with Documentation/devicetree/bindings/ and include/) or takes a typed path. Step 2 searches the tree's .dts files with a live filter: every key narrows the list, the arrows move the highlight, Enter picks, Esc goes back to the architectures. Step 3 names the overlay file. Then the binding caches are built, unless they are current (copied here, so it is quick)." \
    "the letter of ${BOLD}$LINUX${RESET} (or type ${BOLD}~/linux_adi${RESET}) · Enter (search) · ${BOLD}arm${RESET} · in the filter: ${BOLD}rpi-4${RESET}, try ↓ ↑, Esc and ${BOLD}arm${RESET} again if you like, then ${BOLD}bcm2711-rpi-4-b${RESET} Enter · Enter (overlay.dtso)" \
    ""

# The template steps copy from the RPi overlays of $LINUX; another tree may have none.
configured=$(sed -n 's/^linux = "\(.*\)"$/\1/p' .attach-linux/config.toml 2>/dev/null || true)
if [[ "$configured" != "$LINUX" ]]; then
    # The wizard rebuilt the caches for the other tree: the copies for $LINUX make init quick again.
    for cache in compat-index.json validation.json validation.stamp.json; do
        [[ -f "$CACHES/$cache" ]] && cp "$CACHES/$cache" .attach-linux/
    done
    step "Back to $LINUX" \
        "The wizard set ${configured:-no tree}. The later steps copy from the Raspberry Pi overlays of $LINUX (arch/arm/boot/dts/overlays), so init points the workspace there, with options this time." \
        "init --linux $LINUX --devicetree $DTS"
fi

step "What init wrote" \
    "linux, devicetree and overlay in the local config, and an empty overlay file." \
    "config-get linux devicetree overlay"

step "init with options, for scripts and AI tools" \
    "With --linux and --devicetree, --json, or piped, init never asks. A value left out comes from the config, so a re-run keeps everything: created and indexed are false (the overlay was kept, the caches were current). --overlay creates a new file and never overwrites one." \
    "--json init | python3 -m json.tool" \
    "init --overlay overlay" \
    "init --linux /tmp --devicetree $DTS"

step "create-workfile and attach-manifest are gone" \
    "init replaces create-workfile; attach-manifest was removed." \
    "create-workfile" \
    "attach-manifest"

# --- parent question and automatic fills ---

chapter "2. add: the parent question and what the interview fills in"

live "No --parent: add asks for it" \
    "Without --parent, on a terminal the first question is the parent: a lettered list of the buses the device can sit on ('list parent'); Enter takes the first. Then the interview sets, with one line each and no question, what the binding pins to a single value (#address-cells, #size-cells) and spi-cpol, which the AD5592R binding requires only in an if/then branch (the AD5593R's forbids it). spi-max-frequency comes from the binding's SPI example. Nothing is left to ask." \
    "Enter (the first bus, spi0)" \
    "add adi,ad5592r --label dac"

step "if/then: required for the AD5592R, absent for the AD5593R" \
    "The two parts share a binding. spi-cpol is required for adi,ad5592r and not offered for adi,ad5593r (on I2C). --quiet adds without asking and lists what is missing." \
    "read dac" \
    "list property dac" \
    "add adi,ad5593r --parent i2c1 --label dac_i2c --quiet" \
    "list property dac_i2c"

live "reg from the I2C example, and lettered picks" \
    "On I2C the interview takes reg from the binding's I2C example (0x2a) and renames the node to match. Then the questions: options are picked by letter (a number is always a value), and interrupts is asked cell by cell for the chosen controller, the IRQ type lettered too. interrupt-parent no longer carries a help paragraph." \
    "${BOLD}b${RESET} (gpio) · ${BOLD}17${RESET} · ${BOLD}c${RESET} (IRQ_TYPE_EDGE_FALLING)" \
    "add adi,adxl345 --parent i2c1 --label acc"

step "Not on a terminal: the first bus, with a note" \
    "Piped (or with --quiet, or --json), add asks nothing: the parent is the first 'list parent' bus, with a note saying how to choose another (on stderr under --json). --quiet lists the missing required properties instead of asking." \
    "list parent adi,adxl345" \
    "add adi,adxl345 --label acc_spi --quiet"

# --- lettered picks, child interview ---

chapter "3. The interview: letters, cells, child nodes"

live "A wrong letter is asked again" \
    "The AD7124-8 on spi1. z is not an option, so the question comes again; b picks gpio. spi-max-frequency was filled from the example." \
    "${BOLD}z${RESET} · ${BOLD}b${RESET} · ${BOLD}25${RESET} · ${BOLD}b${RESET} (IRQ_TYPE_EDGE_RISING)" \
    "add adi,ad7124-8 --parent spi1 --label adc"

live "A child node gets the same interview" \
    "update <node> <child> creates a channel and asks for its required properties: diff-channels is a fixed pair, asked one value per line." \
    "${BOLD}0${RESET} · ${BOLD}17${RESET} (AIN0 against AVSS)" \
    "update adc channel@0"

step "--quiet everywhere, --no-interview gone" \
    "update's --quiet lists a new child's missing properties instead of asking; on a property it still means 'value only'. --no-interview was renamed to --quiet." \
    "update adc channel@1 --quiet" \
    "update adc reg --quiet" \
    "add adi,ad7124-8 --parent spi2 --no-interview"

# --- GPIO rows ---

chapter "4. GPIOs in the interview"

live "ctrl-gpios, row by row" \
    "HMC425A's binding requires ctrl-gpios with 6 rows (from an if/then). Each row asks the controller (enabled gpio-controllers first; Enter takes the first, and from row 2 on the previous row's), then the line number, then the flags as a lettered GPIO_* pick (Enter = GPIO_ACTIVE_HIGH). Its only valid parent is the root, so there is no parent question." \
    "for each of the 6 rows: Enter · a line number (${BOLD}5${RESET}, ${BOLD}6${RESET}, ${BOLD}12${RESET}, ${BOLD}13${RESET}, ${BOLD}16${RESET}, ${BOLD}26${RESET}) · Enter (or ${BOLD}b${RESET} for GPIO_ACTIVE_LOW)" \
    "add adi,hmc425a --label att"

step "The rows as written" \
    "One phandle-plus-cells entry per row." \
    "read att ctrl-gpios --quiet"

live "An unsized list: \"another row?\"" \
    "adi,one-bit-adc-dac requires in-gpios and out-gpios with no fixed count: one row, then 'another row?' (y adds one, Enter is done)." \
    "in-gpios: Enter · ${BOLD}17${RESET} · Enter · ${BOLD}y${RESET} · Enter · ${BOLD}27${RESET} · Enter · Enter (done)   out-gpios: Enter · ${BOLD}23${RESET} · Enter · Enter (done)" \
    "add adi,one-bit-adc-dac --label oba"

step "And without a terminal" \
    "--json lists ctrl-gpios as missing, the gpio-controllers as its suggestions." \
    "--json add adi,hmc425a --name attenuator-2 --label att_json 2>/dev/null | python3 -c 'import json,sys; r=json.load(sys.stdin); print(json.dumps([[m[\"property\"], [s[\"value\"] for s in m[\"suggestions\"]]] for m in r[\"missing_required\"]]))'"

# --- templates ---

chapter "5. add --template: required, example:N, overlay:name"

step "Copy a device from an overlay of the Linux tree" \
    "overlay:<name> finds the overlay as import does and copies the device's node with its children (the channels here). Without --parent it goes where the overlay put it (spi0). Copies keep the node as written and never interview; references that resolve to nothing are listed." \
    "add adi,ad7124-8 --template overlay:rpi-ad7124-8-all-diff --label adc_copy" \
    "read adc_copy --quiet"

step "Copy a binding example" \
    "example:N copies the node of the binding's example N. ADXL345's example 1 is on I2C, example 2 on SPI: without --parent the copy goes on the first bus of the example's kind (i2c0if here). The example's interrupt-parent names a controller this board doesn't have, so it is listed; update fixes it. A number with no example is refused." \
    "add adi,adxl345 --template example:1 --label acc_example --quiet" \
    "update acc_example interrupt-parent gpio" \
    "add adi,adxl345 --template example:9"

step "Which overlays have the device" \
    "list overlay grades each overlay of the tree for the board. It also lists overlays with another compatible of the same binding, marked 'via'. --from-example was replaced by --template." \
    "list overlay adi,ad7124-8" \
    "add adi,ad7124-8 --parent spi0 --from-example"

# --- wrap-up ---

chapter "6. The result"

header "The overlay" "Everything above, in the file init created."
sed 's/^/  /' overlay.dtso
echo ""
pause

step "Validate" \
    "dt-validate on the overlay, plus the chip-select clashes on spi0. The errors are what the --quiet steps left unset (dac_i2c's cells, acc_spi's interrupts, adc's channel@1, att_json's ctrl-gpios)." \
    "validate"

live "Re-run the wizard" \
    "A second run shows the configured values as the Enter defaults, marked (current), and offers to keep the overlay or start a new one." \
    "Enter · Enter · Enter (keeps everything)" \
    ""

chapter "Done"
echo ""
echo -e "  Overlay:  ${BOLD}$SANDBOX/overlay.dtso${RESET}"
echo ""

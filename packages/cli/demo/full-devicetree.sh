#!/usr/bin/env bash
set -euo pipefail

# The output setting with the linux backend: an ADXL355 accelerometer on SPI 0
# of a Digilent Cora Z7S (Zynq-7000). The Cora boots one devicetree that U-Boot
# loads from the BOOT partition and applies no overlay, so the workfile is
# built into a full devicetree: a .dts that includes the board's and adds the
# overlay's nodes, compiled into a .dtb.
#
# Usage: demo/full-devicetree.sh [--no-pause]
#
# Needs ADI's Linux tree at ~/linux_adi (or DEMO_LINUX) and the built CLI
# (yarn workspace @analog-attach/cli build). The workspace is
# demo/full-devicetree-workspace/, or DEMO_WORKSPACE; it is emptied first.

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
DTC="$PKG_DIR/bundled/linux/tools/dtc"
SANDBOX="${DEMO_WORKSPACE:-$SCRIPT_DIR/full-devicetree-workspace}"
LINUX="${DEMO_LINUX:-$HOME/linux_adi}"
BASE="$LINUX/arch/arm/boot/dts/xilinx/zynq-coraz7s.dts"

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

# A step of shell commands, to look at what the CLI wrote.
shell_step() {
    local title="$1"; shift
    local desc="$1"; shift
    heading "$title" "$desc"

    for cmd in "$@"; do
        echo -e "  ${YELLOW}\$ ${cmd}${RESET}"
        eval "$cmd" 2>&1 | sed 's/^/  /'
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

for path in "$LINUX" "$BASE" "$CLI" "$DTC"; do
    if [[ ! -e "$path" ]]; then
        echo -e "${RED}Missing prerequisite: $path${RESET}" >&2
        exit 1
    fi
done

# --- Sandbox: empty, so config linux builds the binding caches ---

if [[ -d "$SANDBOX" && -n "$(ls -A "$SANDBOX")" && ! -d "$SANDBOX/.analog-attach" ]]; then
    echo -e "${RED}$SANDBOX is not empty and is not a workspace: not emptying it${RESET}" >&2
    exit 1
fi
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX"
cd "$SANDBOX"

# The bundled dtc as plain dtc, to look at the .dtb with.
export PATH="$(dirname "$DTC"):$PATH"

banner "analog-attach: a full devicetree for a board without overlays"
echo ""
echo -e "  Target:  ${BOLD}ADXL355${RESET} 3-axis accelerometer (adi,adxl355) on SPI 0"
echo -e "  Board:   ${BOLD}Cora Z7S${RESET} — Zynq-7000, boots one devicetree.dtb, applies no overlay"
echo -e "  Base DT: ${BOLD}zynq-coraz7s.dts${RESET}, bindings from ${BOLD}$LINUX${RESET}"
echo ""
echo -e "  ${DIM}The device is configured as an overlay, as on any board; then the output"
echo -e "  setting makes build write the whole devicetree instead of a .dtbo.${RESET}"
if $PAUSE; then
    echo ""
    echo -e "  ${DIM}[press Enter to start]${RESET}"
    read -r
fi

# --- Set up ---

step "Set up the workspace" \
    "The Linux tree, the Cora's devicetree and the workfile's name go to .analog-attach/config.json; setting linux builds the binding caches (once per Linux tree). init creates the empty workfile adxl355.dtso. The workfile is an overlay whatever the output: every command edits it the same way." \
    "config backend linux" \
    "config linux $LINUX" \
    "config devicetree $BASE" \
    "config workfile adxl355.dtso" \
    "init"

# --- Configure the device ---

step "Find the device and where it goes" \
    "The ADXL355 talks SPI or I2C, so every SPI and I2C controller of the board can host it. Here it is wired to the PS SPI controller spi0, chip select 0." \
    "list devices adxl35" \
    "list parent adi,adxl355"

step "Add it" \
    "add writes the node under spi0 on the first free chip select. spi0 is disabled in the board's devicetree, so enable it; rename gives the node the generic name the kernel's devicetrees use." \
    "add adi,adxl355 --parent spi0 --label accel" \
    "enable spi0" \
    "rename accel accelerometer@0" \
    "update accel spi-max-frequency 1000000" \
    "validate"

# --- Build ---

step "Build, as for a Raspberry Pi" \
    "Wrong turn: with the default output, build compiles the workfile into build/adxl355.dtbo. A Raspberry Pi's firmware applies that at boot; the Cora's U-Boot loads devicetree.dtb and nothing else, so the .dtbo would never be applied." \
    "build" \
    "config output"

step "Switch to a full devicetree" \
    "output full makes build write build/adxl355.dts, the board's devicetree with the overlay applied, preprocess it as the base is, and compile it into build/adxl355.dtb." \
    "config output full" \
    "build"

shell_step "What build wrote" \
    "build/adxl355.dts is written as ADI's own board files are (zynq-coraz7s-ad7190.dts and the others): an #include of the board's devicetree, then a block per fragment of the overlay (here one, for spi0). The #include is relative, since the workspace and the Linux tree share a directory." \
    "cat build/adxl355.dts"

shell_step "The .dtb is the whole board" \
    "Decompiled with the bundled dtc: the Cora's SPI controller, now enabled, with the accelerometer under it. No __fixups__: nothing is left for a loader to resolve." \
    "dtc -I dtb -O dts build/adxl355.dtb 2>/dev/null | grep -A 18 'spi0: spi@e0006000'" \
    "dtc -I dtb -O dts build/adxl355.dtb 2>/dev/null | grep -c __fixups__ || true"

banner "Done"
echo ""
echo -e "  Workfile:    ${BOLD}$SANDBOX/adxl355.dtso${RESET}"
echo -e "  Devicetree:  ${BOLD}$SANDBOX/build/adxl355.dts${RESET} → ${BOLD}adxl355.dtb${RESET}"
echo -e "  Next:        ${DIM}deploy (after config deploy-ip, deploy-user and deploy-password)"
echo -e "               copies build/adxl355.dtb over the board's /boot/devicetree.dtb and reboots it${RESET}"
echo ""

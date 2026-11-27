#!/usr/bin/env bash
# Run once by the Dockerfile: the base devicetree the grader applies overlays to, and the
# analog-attach projects the cases start from, in /workspace:
#
#   rpi4         a Raspberry Pi 4 project, its overlay empty (most cases)
#   rpi4-adc     the same with an AD7124-8 on SPI0 CS1, complete and valid
#   rpi4-broken  the same AD7124-8, but validate reports errors (no interrupt, a channel
#                without diff-channels, a reference-select the binding doesn't allow)
#   fresh        an empty folder (the setup case)
#
# Each project is made with the CLI, as a user would, so the build also checks the CLI works.
set -euo pipefail

linux=/opt/linux
base="$linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"
eval_root=/opt/aa-eval
aa() { analog-attach --json "$@"; }
ok() { "$@" | tail -n 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else f"not ok: {d}")'; }

# The binary unpacks its assets into $XDG_CACHE_HOME once. Its skills go: a baseline agent must
# not be able to install the skill under evaluation (`skill install` then finds no SKILL.md).
analog-attach --version
rm -rf "$XDG_CACHE_HOME"/analog-attach/*/skills
if find "$XDG_CACHE_HOME" -name SKILL.md | grep -q .; then echo "a SKILL.md is left in $XDG_CACHE_HOME" >&2; exit 1; fi

# The base, with symbols, for fdtoverlay.
mkdir -p "$eval_root/originals/rpi4"
cpp -nostdinc -undef -x assembler-with-cpp -P -I "$linux/include" -I "$(dirname "$base")" -o /tmp/base.pp.dts "$base"
dtc -q -@ -I dts -O dtb -o "$eval_root/base.dtb" /tmp/base.pp.dts
rm /tmp/base.pp.dts

mkdir -p /workspace/rpi4 /workspace/fresh /workspace/output
cd /workspace/rpi4
ok aa config backend linux
ok aa config linux "$linux"          # builds the binding caches
ok aa config devicetree "$base"
ok aa config workfile overlay.dtso
ok aa init
cp overlay.dtso "$eval_root/originals/rpi4/overlay.dtso"

# An AD7124-8 on SPI0 CS1 (the spidev there disabled, SPI0 enabled), in `project`.
ad7124() {
	local project="$1"
	cp -a /workspace/rpi4 "$project"
	cd "$project"
	ok aa config workfile overlay.dtso   # the copy's own, not rpi4's
	ok aa add adi,ad7124-8 --parent spi --name adi,ad7124-8@1 --label adc
	ok aa disable spidev1
	ok aa enable spi
	ok aa update adc channel@0
}

ad7124 /workspace/rpi4-adc
ok aa update adc interrupt-parent gpio
ok aa update adc interrupts 25 IRQ_TYPE_EDGE_FALLING
ok aa update adc/channel@0 diff-channels 0 1
aa validate | tail -n 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if not d["errors"] and not d["warnings"] else f"rpi4-adc does not validate: {d}")'

ad7124 /workspace/rpi4-broken
ok aa update adc/channel@0 adi,reference-select 2   # outside the binding's enum: written, with a warning
aa validate | tail -n 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["errors"] else "rpi4-broken has no errors")'

echo "projects ready: $(ls /workspace)"

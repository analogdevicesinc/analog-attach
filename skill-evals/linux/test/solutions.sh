# A reference solution for each case of evals/evals.json, as a user would type it with the CLI.
# test-grader.sh runs `solve_<case>` (the id, - as _) in the image, then the grader, which must
# give 1.0. Sourced in the container: `aa` is the CLI in JSON mode, failing on a refusal.
aa() {
	local out
	out="$(analog-attach --json "$@")" || { echo "analog-attach $*: exit $?" >&2; return 1; }
	printf '%s\n' "$out" | tail -n 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") else f"not ok: {d}")'
}

# The agent's final message, as the trajectory has it.
say() {
	mkdir -p /logs/agent
	python3 -c 'import json,sys; json.dump({"schema_version": "1", "steps": [{"source": "user", "message": "…"}, {"source": "agent", "message": sys.argv[1]}]}, open("/logs/agent/trajectory.json", "w"))' "$1"
}

solve_ad7124_spi0_cs1() {
	cd /workspace/rpi4
	aa add adi,ad7124-8 --parent spi --name adi,ad7124-8@1 --label adc
	aa disable spidev1
	aa enable spi
	aa update adc interrupt-parent gpio
	aa update adc interrupts 25 IRQ_TYPE_EDGE_FALLING
	aa update adc channel@0
	aa update adc/channel@0 diff-channels 0 1
}

solve_adxl345_i2c1() {
	cd /workspace/rpi4
	aa add adi,adxl345 --parent i2c1 --name accelerometer@53 --label accel
	aa update accel interrupt-parent gpio
	aa update accel interrupts 4 IRQ_TYPE_EDGE_RISING
	aa enable i2c1
}

solve_adxl345_spi0_cs0() {
	cd /workspace/rpi4
	aa add adi,adxl345 --parent spi --name accelerometer@0 --label accel
	aa update accel spi-max-frequency 5000000
	aa update accel spi-cpol
	aa update accel spi-cpha
	aa update accel interrupt-parent gpio
	aa update accel interrupts 17 IRQ_TYPE_EDGE_RISING
	aa disable spidev0
	aa enable spi
}

solve_hmc425a_gpios() {
	cd /workspace/rpi4
	aa add adi,hmc425a --label att
	aa update att ctrl-gpios "gpio 5 GPIO_ACTIVE_HIGH, gpio 6 GPIO_ACTIVE_HIGH, gpio 13 GPIO_ACTIVE_HIGH, gpio 19 GPIO_ACTIVE_HIGH, gpio 26 GPIO_ACTIVE_HIGH, gpio 21 GPIO_ACTIVE_HIGH"
}

solve_setup_fresh() {
	cd /workspace/fresh
	aa config backend linux
	aa config linux /opt/linux
	aa config devicetree /opt/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
	aa config workfile rpi4.dtso
	aa init
}

solve_import_ad7124_overlay() {
	cd /workspace/rpi4
	analog-attach --json import rpi-ad7124-8-all-diff >/dev/null   # severity warn: references to fix
}

solve_fix_validation() {
	cd /workspace/rpi4-broken
	aa update adc interrupt-parent gpio
	aa update adc interrupts 25 IRQ_TYPE_EDGE_FALLING
	aa update adc/channel@0 diff-channels 2 3
	aa delete adc/channel@0 adi,reference-select
}

solve_refin1_regulator() {
	cd /workspace/rpi4-adc
	aa add regulator-fixed --label vref
	aa update vref regulator-name vref-2v5
	aa update vref regulator-min-microvolt 2500000
	aa update vref regulator-max-microvolt 2500000
	aa update vref regulator-always-on
	aa update adc refin1-supply vref
}

solve_rewire_cs0() {
	cd /workspace/rpi4-adc
	analog-attach --json rename adc adi,ad7124-8@0 >/dev/null   # warns: spidev@0 has CS0 until disabled
	aa disable spidev0
	aa enable spidev1
}

solve_build_overlay() {
	cd /workspace/rpi4-adc
	aa build
}

solve_deploy_settings() {
	cd /workspace/rpi4-adc
	aa config var BOARD_IP 192.168.2.10
	aa config var BOARD_USER pi
}

solve_ask_wiring() {
	say "Before I add it: which SPI bus and chip select is the AD7124-8 wired to, and which GPIO does its interrupt (RDY/DOUT) go to?"
}

solve_negative_count_dts() {
	find /opt/linux/arch/arm/boot/dts/broadcom -maxdepth 1 -name '*bcm2711*.dts' | wc -l >/workspace/output/count.txt
}

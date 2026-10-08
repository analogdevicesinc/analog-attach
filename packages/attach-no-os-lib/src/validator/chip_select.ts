/**
 * Two SPI devices must never share a chip-select: both would be selected, and answer, on
 * every transfer. Bootstrap never hands out a taken line, but a user can still set one by
 * hand, so the workfile is checked for it too.
 *
 * The fields are read from capi's `chip_select` binding, so nothing here names a capi type.
 * A GPIO chip-select is one physical pin, so it clashes across buses too; a native line only
 * clashes with another device on the same controller.
 */

import { get_registry } from "../registry/registry";
import type { ChipSelectBinding } from "../registry/module_yml";
import type { Ruleset } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";
import type { ValidationError } from "./types";

function value_of(node: Ruleset | undefined, property: string): unknown {
	return node?._t === "RulesetStruct" || node?._t === "RulesetDescriptor"
		? node.properties.find(candidate => candidate.name === property)?.value
		: undefined;
}

/** A device's GPIO chip-selects, each as its port reference and pin number. */
function gpio_pins(workfile: Workfile, device: Ruleset, binding: ChipSelectBinding): { key: string, shown: string }[] {
	const pins = value_of(device, binding.gpio_list);
	return (Array.isArray(pins) ? pins : [pins]).flatMap(pin => {
		const node = typeof pin === "string" ? workfile.symbols[pin] : undefined;
		const port = value_of(node, binding.pin_port);
		const number = value_of(node, binding.pin_number);
		return typeof port === "string" && typeof number === "number"
			? [{ key: `${port}#${String(number)}`, shown: `${port} pin ${String(number)}` }]
			: [];
	});
}

/** The bus a device is on: the references it holds other than its pin list. */
function bus_of(device: Ruleset, binding: ChipSelectBinding): string | undefined {
	if (device._t !== "RulesetStruct") {
		return undefined;
	}
	const bus = device.properties.find(property => property._t === "IncludeProperty"
		&& property.name !== binding.gpio_list && typeof property.value === "string");
	return typeof bus?.value === "string" ? bus.value : undefined;
}

export function validate_chip_selects(workfile: Workfile): ValidationError[] {
	const registry = get_registry();
	const binding = registry.ok ? registry.value.chip_select : undefined;
	if (binding === undefined) {
		return [];
	}

	const devices = Object.entries(workfile.symbols).filter(([, node]) => node.$symbol === binding.device);
	const errors: ValidationError[] = [];

	for (const [index, [name, device]] of devices.entries()) {
		for (const [other_name, other] of devices.slice(index + 1)) {
			const other_pins = gpio_pins(workfile, other, binding);
			for (const pin of gpio_pins(workfile, device, binding)) {
				if (other_pins.some(candidate => candidate.key === pin.key)) {
					const message = (with_: string) =>
						`shares its GPIO chip-select (${pin.shown}) with '${with_}': both would be selected on every transfer`;
					errors.push(
						{ path: `${name}.${binding.gpio_list}`, message: message(other_name), severity: "error" },
						{ path: `${other_name}.${binding.gpio_list}`, message: message(name), severity: "error" },
					);
				}
			}

			const mask = value_of(device, binding.native_mask);
			const other_mask = value_of(other, binding.native_mask);
			const bus = bus_of(device, binding);
			if (typeof mask === "number" && typeof other_mask === "number" && (mask & other_mask) !== 0
				&& bus !== undefined && bus === bus_of(other, binding)) {
				const message = (with_: string) =>
					`shares a native chip-select line on ${bus} with '${with_}': both would be selected on every transfer`;
				errors.push(
					{ path: `${name}.${binding.native_mask}`, message: message(other_name), severity: "error" },
					{ path: `${other_name}.${binding.native_mask}`, message: message(name), severity: "error" },
				);
			}
		}
	}

	return errors;
}

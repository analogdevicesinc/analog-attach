// The Linux subtypes of the `list` responses (interface/backend-responses.ts has the shared ones).

import type {
	DeviceDescription as BaseDeviceDescription,
	ListDevicesResponse as BaseListDevicesResponse,
	PropertyDescription as BasePropertyDescription,
} from "../../../interface/backend-responses";
import type { CommonResponse, Suggestion, Types } from "./types";

export type { Device } from "../../../interface/backend-responses";

/** A property as the binding describes it: the shared description, plus its type in dt-schema's words. */
export interface PropertyDescription extends BasePropertyDescription {
	/**
	 * dt-schema's type with what the binding constrains it to (`format_dt_type`): `uint32`, `uint32-array · 2 to 4
	 * items`, `phandle-array · 1 row of 3 cells`, `string · one of 3`, `flag`; `untyped` where the binding gives none.
	 */
	dt_type: string;
}

export interface ChildNodeDescription {
	pattern: string;
	/** The pattern's literal start, `channel@N` for `^channel@([0-9]|1[0-5])$`. */
	name: string;
	description?: string;
	properties: PropertyDescription[];
}

/** A device binding: the shared description (`key` is the compatible), plus where it comes from and its child-node patterns. */
export interface DeviceDescription extends BaseDeviceDescription {
	properties: PropertyDescription[];
	compatible: string;
	/** The binding YAML, absolute. */
	binding: string;
	children: ChildNodeDescription[];
}

/** `list devices [filter]`: the compatibles the filter matches, and the device it names, when it names one. */
export interface ListDevicesResponse extends BaseListDevicesResponse {
	device?: DeviceDescription;
	/** @deprecated The keys of `devices`, kept for one release. */
	names: string[];
}

/**
 * `list property <path>`: the names of what the node's binding allows. Without a path: the
 * overlay's nodes, by label-first path, and no `properties`.
 */
export interface ListPropertyNamesResponse extends CommonResponse {
	/** Each property's name, then the regex of each property pattern and child-node pattern; or each node's path. */
	names: string[];
	/**
	 * The binding's named properties, with their types and marks, then each the node has that only a property pattern
	 * defines (`pinctrl-0`), typed as `list property <path> <property>` types it.
	 */
	properties?: Pick<PropertyDescription, "name" | "type" | "display" | "dt_type" | "required" | "set" | "default" | "pinned">[];
	/** The regex of each child-node pattern (`^channel@[0-7]$`), as in `names`. */
	child_patterns?: string[];
	/** @deprecated The same entries with their marks (`compatible (set, required)`), or a node's compatible, kept for one release. */
	suggestions: Suggestion[];
}

/** `list property <path> <property>`: what the binding says about the property. */
export interface ListPropertyTypeResponse extends CommonResponse {
	property: PropertyDescription;
	/** @deprecated `property.type`, kept for one release. */
	type: Types;
	/** @deprecated `property.description`, kept for one release. */
	description?: string;
}

export type ListPropertyResponse = ListPropertyNamesResponse | ListPropertyTypeResponse;

/** A base devicetree of the Linux tree, as `list context` lists it. */
export interface ListedDevicetree {
	/** What `config devicetree` takes: the file, absolute. */
	path: string;
	/** The architecture, `arm64`. */
	arch: string;
	/** The file under `arch/<arch>/boot/dts`, `broadcom/bcm2711-rpi-4-b.dts`. */
	name: string;
	/** Set on the configured `devicetree`. */
	configured?: true;
}

/** `list context`: the base devicetrees of the Linux tree. */
export interface ListContextResponse extends CommonResponse {
	devicetrees: ListedDevicetree[];
}

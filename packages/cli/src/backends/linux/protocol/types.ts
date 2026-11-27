// The Linux backend's --json responses: the shared shapes of interface/backend-responses.ts,
// and the Linux subtypes (more fields, narrower types) in `LinuxResponses`.

import type {
	BuildResponse as BaseBuildResponse,
	CommonResponse,
	InitResponse as BaseInitResponse,
	PropertyConstraints,
	PropertySuggestions,
	PropertyType,
	PropertyValue,
	Responses,
	Suggestion,
	SuggestResponse,
} from "../../../interface/backend-responses";
import type { ListContextResponse, ListDevicesResponse, ListPropertyResponse } from "./descriptions";
import type { ErrorType } from "../../../interface/error-types";
import type { ProjectVariable } from "../../../interface/backend-interface";

export type { CommonResponse, PropertyConstraints, PropertySuggestions, PropertyValue, Severity, Suggestion, SuggestResponse } from "../../../interface/backend-responses";

export interface Config {
	field_name: string;
	category?: string;
	description: string;
	type: "numeric" | "string" | "bool" | "path" | ConfigEnum;
	required: boolean;
	default: string | number | boolean | null;
	value: string | number | boolean | null;
}

export interface ConfigEnum {
	options: (string | number)[];
}

/** A command whose workspace doesn't load (COM-071): a refusal that names each problem. */
export interface ConfigRefusal extends CommonResponse {
	ok: false;
	/** The first error's. */
	error_type: ErrorType;
	errors: { field: string; kind: "missing" | "invalid" | "unknown"; error_type: ErrorType; message: string; description?: string }[];
	hints: string[];
}

export interface ToolConfigResponse extends CommonResponse {
	configs: Config[];
}

/** `init`: the workspace it set up. `path` and `created` are the shared ones. */
export interface InitResponse extends BaseInitResponse {
	linux: string;
	devicetree: string;
	/** @deprecated The workfile, absolute: the same as `path`, kept for one release. */
	overlay: string;
	/** The scripts at the project root (`aa_build.sh`, `aa_deploy.sh`): written now, or kept. One that couldn't be written is left out, with a warning. */
	scripts?: InitScript[];
}

/** A script `init` wrote or kept. */
export interface InitScript {
	/** Absolute. */
	path: string;
	/** False when the file was there and kept. */
	created: boolean;
	/** The project variables its starter uses that init set now, with it (INIT-107): none for a script kept, or a variable the project had. */
	variables: ProjectVariable[];
}

/** `init --restore <build|deploy>`: the starter written over the script. */
export interface RestoreResponse extends CommonResponse {
	path: string;
	/** False when it replaced a file. */
	created: boolean;
	/** The project variables its starter uses that were set now (INIT-107), as on `InitScript`. */
	variables: ProjectVariable[];
}

export interface AddResponse extends CommonResponse {
	key: string;
	path: string[];
	/** The new node's label (with --dry-run, the one add would give it). */
	label: string;
	/** What the node started from: `required`, `example:<N>` or `overlay:<name>`. */
	template: string;
	/** With --dry-run: nothing was written. */
	dry_run?: true;
	/** With --dry-run: the node as the overlay file would have it, in devicetree source. */
	node?: string;
	/** Required properties the node still lacks, in the order to set them (dependencies first). */
	missing_required: MissingProperty[];
	/** With --template example:<N> or overlay:<name>: the references in the copied node that name nothing in the base or overlay. */
	unresolved?: UnresolvedEntry[];
}

/** `update <path> <child-name>` when it creates the child node. */
/** `update`: a property set, a child node created (`UpdateChildResponse`), a read (`ReadResponse`), or the values `--suggest` lists (`ListValueResponse`). */
export type UpdateResponse = CommonResponse | UpdateChildResponse | ReadResponse | ListValueResponse;

/** `list value` (and `update --suggest`): the values, then the providers the user can add instead, when there are any. */
export interface ListValueResponse extends SuggestResponse {
	can_create?: Suggestion[];
}

export interface UpdateChildResponse extends CommonResponse {
	path: string[];
	/** Required properties the child still lacks, in the order to set them. */
	missing_required: MissingProperty[];
}

export interface UnresolvedEntry {
	path: string[];
	property: string;
	/** As written: `&label` or `&{/path}`. */
	reference: string;
}

export interface MissingProperty {
	property: string;
	description?: string;
	/** Values ready for `update`, as in `list value`. */
	suggestions: Suggestion[];
}

/**
 * `min_items` / `max_items` of an array: how many values (cells) the binding allows, when it says:
 * value arrays, and interrupts once the interrupt-parent is known; for an array of arrays (`reg`),
 * how many rows.
 */
export type Types = PropertyType;

export interface Property {
	kind: "property";
	key: string;
	type: Types;
	value: PropertyValue;
}

export interface Node {
	kind: "node";
	key: string;
	properties: Property[];
	children: Node[];
	alias?: string[];
}

/** Where a value `read` shows is set: the base devicetree, or the overlay (which may override the base). */
export type ValueSource = "base" | "overlay";

export interface ReadProperty extends Property {
	source: ValueSource;
	/**
	 * `value` with each number as the overlay (or the preprocessed base) writes it: `"0x53"` where `value` has 83,
	 * `"83"` for a decimal one, in the same nesting, the other values as in `value` (READ-054). Only when the value has
	 * a number.
	 */
	written?: PropertyValue;
}

/**
 * A node as the base and the overlay together have it. `origin` is "internal"
 * when the overlay adds or changes it, "external" when only the base has it.
 * A child the overlay doesn't reach is a base node given by its name and
 * labels only, with no properties or children: `read` on its path shows the
 * rest.
 */
export interface ReadNode extends Omit<Node, "properties" | "children"> {
	properties: ReadProperty[];
	children: ReadNode[];
	origin: "internal" | "external";
	/** The node's `status` ("okay", "disabled", ...) when it has one, a collapsed child's too. */
	status?: string;
	/** A collapsed child's: whether it has children, which `read` on its path gives. */
	has_children?: boolean;
}

/** One property read on its own: what the binding says of it, when the node has a binding. */
export interface ReadPropertyDetails extends ReadProperty {
	description?: string;
	required?: boolean;
	constraints?: PropertyConstraints;
	/** The binding file the property's definition comes from (`adi,ad7124.yaml`). */
	definition?: string;
	/**
	 * Its type in dt-schema's words, as `PropertyDescription.dt_type`; `untyped` when the binding gives none or there is no
	 * binding. Left out when no binding is read (`--quiet`).
	 */
	dt_type?: string;
	suggestions?: PropertySuggestions;
}

/** The node or the property, with `ok`, `message` and `severity` alongside (GEN-08). */
export type ReadResponse = CommonResponse & (ReadNode | ReadPropertyDetails);

export interface DeletePreview extends CommonResponse {
	node_count: number;
	property_count: number;
	paths: string[][];
}

export type DeleteResponse = CommonResponse | DeletePreview;

export interface ValidationError {
	kind: "generic";
	path: string[];
	message: string;
	/** Which kind of finding it is (GEN-17). */
	error_type: ErrorType;
}

export interface ValidationResponse extends CommonResponse {
	errors: ValidationError[];
	warnings: ValidationError[];
	/** With `--full`: the merged tree's findings on what the overlay doesn't touch, left out. */
	base_findings?: number;
}

export interface ListOverlayResponse extends CommonResponse {
	/**
	 * Compatible ones first, then unknown, then incompatible; within each, overlays with the compatible
	 * itself before those with another of its binding (`matched`). Without a compatible, every overlay.
	 */
	overlays: OverlayDescription[];
}

/** `list node`: the nodes of the merged tree, or those the filter matches (LIST-140, LIST-142). */
export interface ListNodeResponse extends CommonResponse {
	/** Depth first in tree order, the root first. */
	nodes: ListedNode[];
}

/** A node of the merged tree (the base with the overlay applied), without its properties: `read <path>` gives them. */
export interface ListedNode {
	/** Absolute, as `read` takes it. */
	path: string;
	/** Its name with its unit address (`gpio@7e200000`); `/` for the root. */
	key: string;
	labels: string[];
	compatible: string[];
	/** Its `status` ("okay", "disabled", ...) when it has one. */
	status?: string;
	/** As `ReadNode.origin`: internal when the overlay adds or changes it, external when only the base has it. */
	origin: "internal" | "external";
	/** added: nothing of it is the base's; changed: the overlay sets something on a base node; none. */
	change: "added" | "changed" | "none";
	has_children: boolean;
}

export interface ImportResponse extends CommonResponse {
	/** The new workfile, now the configured overlay. */
	path: string;
	/** The imported overlay source. */
	source: string;
	/** The overlay configured before, which the new workfile replaces as the configured one (the file is kept). */
	replaced?: string;
	/** How the overlay's root compatible fits the base's, as in `list overlay`. */
	fit: "compatible" | "incompatible" | "unknown";
	reason: string;
	/** The fragments whose target names no node of the base or the overlay. */
	unresolved_targets: UnresolvedTargetEntry[];
	/** The references in the fragments that name nothing in the base or overlay. */
	unresolved: UnresolvedEntry[];
}

export interface UnresolvedTargetEntry {
	/** The fragment's node name, e.g. `fragment@0`. */
	fragment: string;
	property: "target" | "target-path";
	/** The label (without `&`) or the path. */
	target: string;
}

export interface OverlayDescription {
	/** The file name, which `import` takes. */
	name: string;
	/** Absolute path. */
	path: string;
	/** The compatibles of the nodes it adds or changes, in file order. */
	devices: string[];
	/** How the overlay's root compatible fits the base's. */
	fit: "compatible" | "incompatible" | "unknown";
	reason: string;
	/** Only when the overlay doesn't add the asked compatible itself: the other compatible of the same binding it adds. */
	matched?: string;
}

export interface TypeResponse extends CommonResponse {
	type: Types;
	description?: string;
	/** Concrete values offered by intelligence layers, ready for `update`. */
	suggestions?: Suggestion[];
}

export interface BuildResponse extends BaseBuildResponse {
	/** The compiled `.dtbo` (the `.dtb` with output `devicetree`), absolute: when aa_build.sh left it where it goes (`$AA_DTBO`, `$AA_DTB`). */
	path?: string;
	/** With output `devicetree`: the full devicetree source build wrote before aa_build.sh compiled it, absolute. */
	source?: string;
}

export type DeployResponse = CommonResponse;

/** The Linux backend's responses: the shared map, with the Linux subtypes of the commands ported so far. */
export interface LinuxResponses extends Responses {
	init: InitResponse | RestoreResponse;
	"list devices": ListDevicesResponse;
	"list context": ListContextResponse;
	"list property": ListPropertyResponse;
	"list value": ListValueResponse;
	add: AddResponse;
	import: ImportResponse;
	read: ReadResponse;
	update: UpdateResponse;
	delete: DeleteResponse;
	validate: ValidationResponse;
	build: BuildResponse;
	deploy: DeployResponse;
}

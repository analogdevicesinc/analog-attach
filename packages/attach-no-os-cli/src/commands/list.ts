import { buildCommand, buildRouteMap } from "@stricli/core";
import {
    list_boards,
    list_socs,
    suggest_for_property,
} from "attach-no-os-lib";
import {
    filter_completions,
    get_node_names,
    get_property_names,
    prior_positionals,
} from "../completion/completion";
import { RESERVED_PREFIX } from "../protocol/convert";
import { common_ok, type SuggestResponse } from "../protocol/responses";
import { listDevicesCommand } from "./list_devices";
import {
    column_width,
    format_property_type,
    get_node,
    load_context,
    output,
    output_error,
    resolve_property_name,
} from "./shared";

/*
 * `attach-noos list <kind>` — what can be used, one kind at a time:
 *
 *   devices    what `add` takes: eval boards, drivers, schemas
 *   context    what a workfile can be made for: the chips, and the boards carrying them
 *   property   the nodes, or one node's properties
 *   value      the values a property can take
 *
 * `attach-noos list` alone prints these kinds, as the help of the route map.
 */

// --- list context ---------------------------------------------------------------------

type ListedPlatform = {
    name: string;
    vendor: string;
    description?: string;
    boards: string[];
};

type ListedBoard = {
    name: string;
    /** The chip the board carries, which is what the `platform` setting names. */
    platform?: string;
    vendor?: string;
    description?: string;
};

/**
 * Every chip, with the boards that carry it. A chip with no board is listed too: it is what
 * the `platform` setting is for. A board is never one the tool cannot generate for, since
 * a platform module declares both its chips and its boards.
 */
const listContextCommand = buildCommand<{ json?: boolean }, []>({
    docs: {
        brief: "List what a workfile can target: the chips, and the boards carrying them",
        fullDescription:
            "Lists every chip the configured platforms support, each with the boards that carry it.\n" +
            "Pick one with 'attach-noos config board <name>' (or 'platform <chip>' for a chip with\n" +
            "no board), then 'attach-noos init'."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const socs = list_socs();
        if (!socs.ok) {
            output_error(flags, socs.error.message);
            return;
        }
        const found = list_boards();
        if (!found.ok) {
            output_error(flags, found.error.message);
            return;
        }

        const boards: ListedBoard[] = found.value.map(board => ({
            name: board.name,
            platform: board.soc,
            vendor: board.vendor,
            description: board.description,
        }));
        const platforms: ListedPlatform[] = socs.value
            .map(({ soc, platform }) => ({
                name: soc.name,
                vendor: platform.vendor ?? platform.name,
                description: soc.cpu,
                boards: boards.filter(board => board.platform === soc.name).map(board => board.name).sort(),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        let text = "";
        for (const platform of platforms) {
            text += `  ${platform.name} (${platform.vendor})\n`;
            text += platform.boards.length > 0
                ? platform.boards.map(board => `      ${board}\n`).join("")
                : "      no board: target the chip with 'attach-noos config platform <chip>'\n";
            text += "\n";
        }
        const counted = `${boards.length} board${boards.length === 1 ? "" : "s"} on ${platforms.length} chip${platforms.length === 1 ? "" : "s"}`;
        text += `${counted}.\nUse: attach-noos config board <name>, then attach-noos init`;

        output(flags, text, { ...common_ok(counted), platforms, boards });
    }
});

// --- list property --------------------------------------------------------------------

/** A property name without the `$`: the spelling every command accepts and a shell does not eat. */
function bare(name: string): string {
    return name.startsWith(RESERVED_PREFIX) ? name.slice(RESERVED_PREFIX.length) : name;
}

/** "required, set", "required", "set" or "". */
function marks(required: boolean | undefined, set: boolean): string {
    return [required === true ? "required" : "", set ? "set" : ""].filter(mark => mark !== "").join(", ");
}

const listPropertyCommand = buildCommand<{ json?: boolean }, [string | undefined]>({
    docs: {
        brief: "List the nodes, or the properties of one node",
        fullDescription:
            "With no <node>, lists the nodes of the workfile. With <node>, lists its properties,\n" +
            "with their type and whether they are required and set."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node whose properties to list", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, node) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        if (node === undefined) {
            const names = Object.keys(context.value.minimal.symbols);
            const response: SuggestResponse = {
                ...common_ok(`${names.length} node${names.length === 1 ? "" : "s"}`),
                suggestions: names.map(value => ({ value, display_string: String(context.value.minimal.symbols[value]?.$compatible ?? "") })),
            };
            output(flags, names.join("\n"), response);
            return;
        }

        const owner = get_node(context.value, node);
        if (!owner.ok) {
            output_error(flags, owner.error.message);
            return;
        }

        const properties = owner.value.properties.filter(property => property.disabled !== true);

        const width = column_width("Property", properties.map(property => bare(property.name)));
        const type_width = column_width("Type", properties.map(property => format_property_type(property._t)));
        const text = properties.map(property => {
            const set = property.value !== undefined && property.value !== null;
            return `${bare(property.name).padEnd(width)}${format_property_type(property._t).padEnd(type_width)}${marks(property.required, set)}`.trimEnd();
        }).join("\n");

        const response: SuggestResponse = {
            ...common_ok(`${properties.length} propert${properties.length === 1 ? "y" : "ies"} on ${node}`),
            suggestions: properties.map(property => {
                const set = property.value !== undefined && property.value !== null;
                const detail = marks(property.required, set);
                return { value: bare(property.name), display_string: `${format_property_type(property._t)}${detail === "" ? "" : ` (${detail})`}` };
            }),
        };
        output(flags, text, response);
    }
});

// --- list value -----------------------------------------------------------------------

/**
 * The values a property can take, and what could be created for it: the list `update
 * --suggest` gives too.
 */
export function value_suggestions(node: string, property: string, member?: string): { ok: true, response: SuggestResponse, text: string } | { ok: false, message: string } {
    const context = load_context();
    if (!context.ok) {
        return { ok: false, message: context.error.message };
    }
    const owner = get_node(context.value, node);
    if (!owner.ok) {
        return { ok: false, message: owner.error.message };
    }
    const resolved = resolve_property_name(owner.value, property);
    if (!owner.value.properties.some(candidate => candidate.name === resolved)) {
        return { ok: false, message: `'${node}' has no property '${property}'` };
    }

    const suggested = suggest_for_property(context.value.workfile, node, resolved, member);
    if (!suggested.ok) {
        return { ok: false, message: suggested.error.message };
    }
    const values = suggested.value.values ?? [];
    const types = suggested.value.types ?? [];

    const lines = [...values];
    if (types.length > 0) {
        lines.push(...(values.length > 0 ? [""] : []), "Can create:", ...types.map(type => `  ${type}`));
    }
    const count = values.length + types.length;
    return {
        ok: true,
        text: count === 0 ? "No suggestions." : lines.join("\n"),
        response: {
            ...common_ok(`${count} suggestion${count === 1 ? "" : "s"}`),
            suggestions: [
                ...values.map(value => ({ value })),
                ...types.map(type => ({ value: type, display_string: `${type} (can create)` })),
            ],
        },
    };
}

const listValueCommand = buildCommand<{ json?: boolean }, [string, string, string | undefined]>({
    docs: {
        brief: "List the values a property can take",
        fullDescription:
            "Lists the values <property> of <node> can take, and the nodes that could be created\n" +
            "for it. For a union, name the member to list the values of that member."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node the property belongs to", parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                },
                {
                    placeholder: "property", brief: "Property whose values to list", parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                },
                { placeholder: "member", brief: "Union member, for a union property", optional: true, parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, node, property, member) => {
        const found = value_suggestions(node, property, member);
        if (!found.ok) {
            output_error(flags, found.message);
            return;
        }
        output(flags, found.text, found.response);
    }
});

export const listRoutes = buildRouteMap({
    routes: {
        devices: listDevicesCommand,
        context: listContextCommand,
        property: listPropertyCommand,
        value: listValueCommand,
    },
    docs: {
        brief: "List what can be used: devices, targets, properties, values",
    },
});

import {
    list_boards,
    list_socs,
    suggest_for_property,
    type Property,
} from "attach-no-os-lib";
import {
    answer,
    command,
    input_error,
    refuse,
    type ListContextArguments,
    type ListPropertyArguments,
    type ListValueArguments,
    type Outcome,
    type Session,
} from "../../../interface/backend-interface";
import { RESERVED_PREFIX } from "../protocol/convert";
import {
    common_ok,
    type ListContextResponse,
    type ListedBoard,
    type ListedPlatform,
    type ListPropertyResponse,
    type SuggestResponse,
} from "../protocol/responses";
import { install } from "../settings";
import {
    column_width,
    format_property_type,
    get_node,
    load_context,
    resolve_property_name,
} from "./shared";

/*
 * `list <kind>`: what can be used, one kind at a time (`list devices` is list_devices.ts):
 *
 *   devices    what `add` takes: eval boards, drivers, schemas
 *   context    what a workfile can be made for: the chips, and the boards carrying them
 *   property   the nodes, or one node's properties
 *   value      the values a property can take
 */

// --- list context ---------------------------------------------------------------------

/**
 * Every chip, with the boards that carry it. A chip with no board is listed too: it is what
 * the `platform` setting is for. A board is never one the tool cannot generate for, since
 * a platform module declares both its chips and its boards.
 */
export const list_context = command<ListContextArguments, ListContextResponse>({
    docs: {
        brief: "List what a workfile can target: the chips, and the boards carrying them",
        full:
            "Lists every chip the configured platforms support, each with the boards that carry it.\n" +
            "Pick one with 'config board <name>' (or 'config platform <chip>' for a chip with\n" +
            "no board), then 'init'."
    },
    run(_arguments, _flags, session) {
        install(session);
        const socs = list_socs();
        if (!socs.ok) {
            return Promise.resolve(refuse(socs.error.message));
        }
        const found = list_boards();
        if (!found.ok) {
            return Promise.resolve(refuse(found.error.message));
        }

        const boards: ListedBoard[] = found.value.map(board => ({
            name: board.name,
            ...(board.soc === undefined ? {} : { platform: board.soc }),
            ...(board.vendor === undefined ? {} : { vendor: board.vendor }),
            ...(board.description === undefined ? {} : { description: board.description }),
        }));
        const platforms: ListedPlatform[] = socs.value
            .map(({ soc, platform }) => ({
                name: soc.name,
                vendor: platform.vendor ?? platform.name,
                ...(soc.cpu === undefined ? {} : { description: soc.cpu }),
                boards: boards.filter(board => board.platform === soc.name).map(board => board.name).toSorted(),
            }))
            .toSorted((a, b) => a.name.localeCompare(b.name));

        const { program } = session;
        let text = "";
        for (const platform of platforms) {
            text += `  ${platform.name} (${platform.vendor})\n`;
            text += platform.boards.length > 0
                ? platform.boards.map(board => `      ${board}\n`).join("")
                : `      no board: target the chip with '${program} config platform <chip>'\n`;
            text += "\n";
        }
        const counted = `${plural(boards.length, "board")} on ${plural(platforms.length, "chip")}`;
        text += `${counted}.\nUse: ${program} config board <name>, then ${program} init`;

        const response: ListContextResponse = { ...common_ok(counted), platforms, boards };
        return Promise.resolve(answer(response, text));
    }
});

function plural(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

// --- list property --------------------------------------------------------------------

/** A property name without the `$`: the spelling every command accepts and a shell does not eat. */
function bare(name: string): string {
    return name.startsWith(RESERVED_PREFIX) ? name.slice(RESERVED_PREFIX.length) : name;
}

/** "required, set", "required", "set" or "". */
function marks(required: boolean | undefined, set: boolean): string {
    return [required === true ? "required" : "", set ? "set" : ""].filter(mark => mark !== "").join(", ");
}

export const list_property = command<ListPropertyArguments, ListPropertyResponse>({
    docs: {
        brief: "List the nodes, or the properties of one node",
        full:
            "With no <node>, lists the nodes of the workfile. With <node>, lists its properties,\n" +
            "with their type and whether they are required and set."
    },
    run({ path: node, property }, _flags, session) {
        if (property !== undefined) {
            return Promise.resolve(input_error(
                `list property takes only a node: '${session.program} read <node> ${property}' describes one property`
            ));
        }
        const context = load_context(session);
        if (!context.ok) {
            return Promise.resolve(refuse(context.error.message));
        }

        if (node === undefined) {
            const { symbols } = context.value.minimal;
            const names = Object.keys(symbols);
            const response: ListPropertyResponse = {
                ...common_ok(plural(names.length, "node")),
                names,
                suggestions: names.map(value => ({ value, display_string: symbols[value]?.$compatible ?? "" })),
            };
            return Promise.resolve(answer(response, names.join("\n")));
        }

        const owner = get_node(context.value, node);
        if (!owner.ok) {
            return Promise.resolve(refuse(owner.error.message));
        }

        const properties = owner.value.properties.filter(entry => entry.disabled !== true);

        const width = column_width("Property", properties.map(entry => bare(entry.name)));
        const type_width = column_width("Type", properties.map(entry => format_property_type(entry._t)));
        const is_set = (entry: Property): boolean => entry.value !== undefined && entry.value !== null;
        const text = properties.map(entry =>
            `${bare(entry.name).padEnd(width)}${format_property_type(entry._t).padEnd(type_width)}${marks(entry.required, is_set(entry))}`.trimEnd()
        ).join("\n");

        const count = `${String(properties.length)} propert${properties.length === 1 ? "y" : "ies"} on ${node}`;
        const response: ListPropertyResponse = {
            ...common_ok(count),
            names: properties.map(entry => bare(entry.name)),
            suggestions: properties.map(entry => {
                const detail = marks(entry.required, is_set(entry));
                return { value: bare(entry.name), display_string: `${format_property_type(entry._t)}${detail === "" ? "" : ` (${detail})`}` };
            }),
        };
        return Promise.resolve(answer(response, text));
    }
});

// --- list value -----------------------------------------------------------------------

/**
 * The values a property can take, and what could be created for it: the list `update
 * --suggest` gives too.
 */
export function value_suggestions(session: Session, node: string, property: string, member?: string): Outcome<SuggestResponse> {
    const context = load_context(session);
    if (!context.ok) {
        return refuse(context.error.message);
    }
    const owner = get_node(context.value, node);
    if (!owner.ok) {
        return refuse(owner.error.message);
    }
    const resolved = resolve_property_name(owner.value, property);
    if (!owner.value.properties.some(candidate => candidate.name === resolved)) {
        return refuse(`'${node}' has no property '${property}'`);
    }

    const suggested = suggest_for_property(context.value.workfile, node, resolved, member);
    if (!suggested.ok) {
        return refuse(suggested.error.message);
    }
    const values = suggested.value.values ?? [];
    const types = suggested.value.types ?? [];

    const lines = [...values];
    if (types.length > 0) {
        lines.push(...(values.length > 0 ? [""] : []), "Can create:", ...types.map(type => `  ${type}`));
    }
    const count = values.length + types.length;
    const response: SuggestResponse = {
        ...common_ok(plural(count, "suggestion")),
        suggestions: [
            ...values.map(value => ({ value })),
            ...types.map(type => ({ value: type, display_string: `${type} (can create)` })),
        ],
    };
    return answer(response, count === 0 ? "No suggestions." : lines.join("\n"));
}

export const list_value = command<ListValueArguments, SuggestResponse>({
    docs: {
        brief: "List the values a property can take",
        full:
            "Lists the values <property> of <node> can take, and the nodes that could be created\n" +
            "for it. For a union, name the member to list the values of that member."
    },
    run({ path: node, property, member }, _flags, session) {
        return Promise.resolve(value_suggestions(session, node, property, member));
    }
});

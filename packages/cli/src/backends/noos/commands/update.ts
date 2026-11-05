import { referenced_nodes, set_value, validate_property_value } from "attach-no-os-lib";
import {
    answer,
    command,
    input_error,
    refuse,
    type FlagSpecs,
    type Outcome,
    type Session,
    type UpdateArguments,
} from "../../../interface/backend-interface";
import { describe_bootstrap, describe_wiring, run_bootstrap } from "./bootstrap_run";
import {
    format_property_value,
    get_node,
    get_node_property,
    load_context,
    refuse_error,
    resolve_property_name,
    save_workfile,
} from "./shared";
import { ELEMENT_SEPARATOR, READONLY_KEYS, RESERVED_PREFIX, parse_property_value } from "../protocol/convert";
import { common_ok, type CommonResponse, type ReadResponse, type SuggestResponse, type UpdateSetResponse } from "../protocol/responses";
import { value_suggestions } from "./list";
import { read_target } from "./read";

const UPDATE_FLAGS = {
    suggest: { kind: "boolean", brief: "List what the property can be set to, instead of setting it" },
} as const satisfies FlagSpecs;

/**
 * `update <node> <property> <value>`: set one property.
 *
 * Not an upsert: a node's properties come from its schema, which is the C struct it
 * generates (a property that is not in the schema is a field that does not exist), so an
 * unknown name is refused with the list of names that do exist.
 *
 * The value arrives as text, so parsing it into a number, an enum member or a union is
 * this command's job (see parse_property_value). A union takes its member and the
 * member's value as two words, or as one `<member>,<value>`.
 *
 * With no value it reads the property instead, as `read` does, and with --suggest it lists
 * what the property can be set to, as `list value` does.
 */
export const update = command<UpdateArguments, CommonResponse | ReadResponse | SuggestResponse, typeof UPDATE_FLAGS>({
    flags: UPDATE_FLAGS,
    docs: {
        brief: "Set a property on a node",
        full:
            "Sets <property> on <node> to <value>. With no <value>, reads the property instead;\n" +
            "with --suggest, lists what it can be set to (for a union, after the member).\n" +
            `A union takes '<member> <value>' (or '<member>${ELEMENT_SEPARATOR}<value>'), an array a comma-separated list.\n` +
            `A property whose name starts with '${RESERVED_PREFIX}' can be written without it: init_param means ${RESERVED_PREFIX}init_param.\n\nExamples:\n  $ analog-attach update adxl355_spi_dev max_speed_hz 2000000\n  $ analog-attach update adxl355_spi_dev cs_gpio cs_pin\n  $ analog-attach update adxl355_ip comm_init spi_dev adxl355_spi_dev\n  $ analog-attach update --suggest adxl355_spi_dev mode`
    },
    run(arguments_, flags, session) {
        return Promise.resolve(run_update(arguments_, flags.suggest === true, session));
    }
});

function run_update(arguments_: UpdateArguments, suggest: boolean, session: Session): Outcome<CommonResponse | ReadResponse | SuggestResponse> {
    const { path: node, property, values, quiet } = arguments_;
    if (node === undefined || property === undefined) {
        return input_error(
            "Nothing to update: pass <node> <property> <value>. " +
            `Use '${session.program} read' to see the nodes and '${session.program} read <node>' to see their properties.`
        );
    }
    if (values.length > 2) {
        return input_error(
            `Too many values for ${node}.${property}: pass one value, a comma-separated list, or a union's member and its value`
        );
    }
    const [value, union_value] = values;

    // The values it can take: a union's are those of the member named after the property.
    if (suggest) {
        if (union_value !== undefined) {
            return input_error("--suggest takes at most a union member after the property");
        }
        return value_suggestions(session, node, property, value);
    }

    // No value: what it is now, rather than an error.
    if (value === undefined) {
        return read_target(session, quiet, node, property);
    }

    const context = load_context(session);
    if (!context.ok) {
        return refuse_error(context.error);
    }

    if (READONLY_KEYS.has(property)) {
        return refuse(`'${property}' describes the node rather than configuring it, and cannot be set`, { type: "read-only" });
    }

    const owner = get_node(context.value, node);
    if (!owner.ok) {
        return refuse_error(owner.error);
    }

    // What the user typed, spelled the way the workfile spells it: `init_param` for
    // `$init_param`. Everything below uses this, not `property`.
    const resolved = resolve_property_name(owner.value, property);

    // Not an upsert: an unknown property is refused, with the names that would work.
    if (!owner.value.properties.some(candidate => candidate.name === resolved)) {
        return refuse(
            `'${node}' has no property '${property}', and one cannot be added: its properties are ` +
            `fixed by its schema (${owner.value.$symbol}). Available: ` +
            owner.value.properties.map(candidate => candidate.name).join(", "),
            { type: "not-found" }
        );
    }

    const lookup = get_node_property(context.value, node, resolved);
    if (!lookup.ok) {
        return refuse_error(lookup.error);
    }

    // Two words for a union ('<member> <value>') fold into the one string the parser expects.
    const raw = union_value === undefined ? value : `${value}${ELEMENT_SEPARATOR}${union_value}`;

    // A value that doesn't parse for the property is refused, as one it doesn't allow is:
    // the command ran, the value is wrong (GEN-09).
    const parsed = parse_property_value(raw, lookup.value.property);
    if (!parsed.ok) {
        return refuse_error(parsed.error);
    }

    const referenced_before = referenced_nodes(context.value.workfile);
    const updated = set_value(context.value.workfile, node, resolved, parsed.value);
    if (!updated.ok) {
        return refuse_error(updated.error);
    }
    // What the definition doesn't allow for the value itself (a bound, an option, an array's
    // elements) is refused here rather than left for validate (UPDATE-02); the workfile on
    // disk is untouched, as nothing is saved.
    const problems = validate_property_value(context.value.workfile, node, resolved);
    if (problems.length > 0) {
        return refuse(problems.map(problem => problem.message).join("; "), { type: "invalid-value" });
    }
    const message = `Set ${node}.${resolved} = ${format_property_value(lookup.value.property)}`;

    // The edit may leave what bootstrap built out of line with the rules, or unused.
    const ran = run_bootstrap(context.value.workfile, referenced_before);
    if (!ran.ok) {
        return refuse(`${message}, but bootstrap failed: ${ran.error.message}`, { type: ran.error.type });
    }

    const saved = save_workfile(context.value);
    if (!saved.ok) {
        return refuse_error(saved.error);
    }

    const text = [message, ...(ran.value === undefined ? [] : describe_bootstrap(ran.value, context.value.workfile, session.program))];
    // The wiring, when the change rewired a bus: as data, for a tool to relay.
    const wired = ran.value === undefined ? undefined : describe_wiring(ran.value, context.value.workfile);
    const rewired = wired !== undefined && (wired.wiring.length > 0 || wired.chip_selects.length > 0);
    const response: UpdateSetResponse = { ...common_ok(message), ...(rewired ? wired : {}) };
    return answer(response, text.join("\n"));
}

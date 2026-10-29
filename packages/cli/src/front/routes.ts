// The route table of one run, and the stricli application built from it.
//
// The table is the one place that knows the grammar: the shared commands with the
// positionals of 01-grammar.abnf (decision 1), each with the active backend's flags merged
// in; the backend's extra commands (decision 2); and the front end's own (`config`,
// `skill`, `completion`). The stricli application (help, parsing) and `__complete`
// (complete.ts) are both built from it, so they can't drift apart.
//
// A shared command the backend leaves out stays routed but hidden, and answers "not
// supported by the <id> backend" (exit 2). With no backend, every shared command points to
// `config backend`.

import {
    buildApplication, buildCommand, buildRouteMap,
    type Application, type Command, type CommandContext, type RouteMap,
} from "@stricli/core";

type RoutingTarget<CONTEXT extends CommandContext> = Command<CONTEXT> | RouteMap<CONTEXT>;
import {
    input_error,
    type Backend, type CommandDocumentation, type CommandImpl, type Commands, type Completion, type FlagSpec, type FlagSpecs,
    type FlagValues, type Outcome, type PositionalSpec, type Session,
} from "../interface/backend-interface";
import type { OutputStreams } from "./output";
import type { Registry } from "./registry";
import type { SettingsFiles, SettingsStore } from "./settings-store";
import type { Environment } from "./stubs";
import { config_route } from "./config";
import { skill_routes } from "./skill";
import { completion_route } from "./stubs";

// =====================================================================================
// What a run has
// =====================================================================================

/** Everything one run of the front end has: the settings, the active backend, the streams. */
export interface FrontEnd {
    readonly program: string;
    readonly version: string;
    readonly json: boolean;
    readonly streams: OutputStreams;
    readonly files: SettingsFiles;
    readonly settings: SettingsStore;
    readonly registry: Registry;
    readonly backend?: Backend;
    /** Why there is no backend (unset, or an id the registry doesn't have); set exactly when `backend` isn't. */
    readonly backend_problem?: string;
    readonly home: string;
    readonly environment: Environment;
    /** Whether `claude --version` runs (`skill install`). */
    readonly claude_installed: () => boolean;
    /** A session for one command. `ask`: it may get a prompter (text mode on a terminal). */
    session(mode: Session["mode"], ask: boolean): Promise<Session>;
}

/** `'analog-attach config backend <linux|noos>'`. */
export function backend_command(front: Pick<FrontEnd, "program" | "registry">): string {
    const ids = Object.keys(front.registry);
    return `'${front.program} config backend <${ids.length === 0 ? "id" : ids.join("|")}>'`;
}

// =====================================================================================
// Routes
// =====================================================================================

export type Group = "setup" | "edit" | "build" | "tooling";
const GROUPS: readonly Group[] = ["setup", "edit", "build", "tooling"];

export type PositionalValues = Readonly<Record<string, string | readonly string[] | undefined>>;
export type FlagInput = Readonly<Record<string, boolean | string | readonly string[] | undefined>>;

export interface RouteInput {
    readonly positionals: PositionalValues;
    readonly flags: FlagInput;
}

export interface Route {
    /** `["list", "parent"]`. */
    readonly path: readonly string[];
    readonly brief: string;
    readonly full?: string;
    readonly examples?: readonly string[];
    readonly group: Group;
    /** Left out of help and of the command names `__complete` offers; still routed. */
    readonly hidden?: boolean;
    readonly positionals: readonly PositionalSpec[];
    readonly flags: FlagSpecs;
    /** The flag that, set, means nothing may be asked (`--quiet`). */
    readonly quiet_flag?: string;
    /** Whether a run may get a prompter. The front end's own commands never ask. */
    readonly asks: boolean;
    /** False for a shared command the backend leaves out (and every shared command without a backend): no backend completion. */
    readonly supported: boolean;
    run(input: RouteInput, session: Session): Promise<Outcome<unknown>>;
    /**
     * The front end's own completion of a positional (`config`'s keys and values). Undefined
     * when the position has no source, so its flags are offered (COMPL-033). Without it, the
     * positional's `slot` goes to `backend.complete`.
     */
    complete?(index: number, prior: readonly string[], partial: string, session: Session): Promise<Completion | undefined>;
}

/** The brief of a route map (`list`, `skill`), for help and `__complete`. */
export const ROUTE_MAP_BRIEFS: Readonly<Record<string, string>> = {
    list: "List devices, properties, values and more",
    skill: "Install or remove a Claude Code skill",
};

type Words = Backend["words"];
const DEFAULT_WORDS: Words = { device: "device", path: "path", workfile: "workfile" };

/** One value of a positional record, as a single word. */
export function one(values: PositionalValues, name: string): string | undefined {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
}

function many(values: PositionalValues, name: string): readonly string[] {
    const value = values[name];
    return Array.isArray(value) ? value as readonly string[] : (typeof value === "string" ? [value] : []);
}

// --- Shared commands -------------------------------------------------------------

interface SharedDefinition {
    readonly route: string;
    readonly group: Group;
    brief(words: Words): string;
    /** `command` is the route, for the slots. */
    positionals(words: Words, command: string): PositionalSpec[];
    /** The front end's flags of the command (`--name`, `--quiet`, `--force`). */
    readonly flags?: FlagSpecs;
    readonly quiet?: boolean;
    implementation(commands: Commands): CommandImpl<unknown, unknown> | undefined;
    arguments_(positionals: PositionalValues, flags: FlagInput): unknown;
}

const path_positional = (words: Words, command: string, optional: boolean): PositionalSpec => ({
    name: "path", placeholder: words.path, brief: "The node", optional,
    slot: () => ({ kind: "path", command }),
});
const property_positional = (command: string, optional: boolean): PositionalSpec => ({
    name: "property", placeholder: "property", brief: "Property name", optional,
    slot: prior => ({ kind: "property", command, path: prior[0] ?? "" }),
});
const quiet_flag = (brief: string): FlagSpecs => ({ quiet: { kind: "boolean", brief } });

const SHARED: readonly SharedDefinition[] = [
    {
        route: "init", group: "setup",
        brief: words => `Create the ${words.workfile}, or keep the configured one`,
        positionals: () => [],
        implementation: commands => commands.init,
        arguments_: () => ({}),
    },
    {
        route: "import", group: "setup",
        brief: words => `Start the ${words.workfile} from an existing source`,
        positionals: () => [{ name: "source", placeholder: "source", brief: "What to import", slot: () => ({ kind: "source" }) }],
        implementation: commands => commands.import,
        arguments_: positionals => ({ source: one(positionals, "source") }),
    },
    {
        route: "add", group: "edit",
        brief: words => `Add a device to the ${words.workfile}`,
        positionals: (words, command) => [{ name: "device", placeholder: words.device, brief: "The device to add", optional: true, slot: () => ({ kind: "device", command }) }],
        flags: {
            name: { kind: "value", brief: "Node name override", placeholder: "name" },
            ...quiet_flag("Don't ask for what is left; list it"),
        },
        quiet: true,
        implementation: commands => commands.add,
        arguments_: (positionals, flags) => ({ device: one(positionals, "device"), name: flags["name"], quiet: flags["quiet"] === true }),
    },
    {
        route: "read", group: "edit",
        brief: words => `Read the ${words.workfile}, a node or a property`,
        positionals: (words, command) => [path_positional(words, command, true), property_positional(command, true)],
        flags: quiet_flag("Print only the values"),
        quiet: true,
        implementation: commands => commands.read,
        arguments_: (positionals, flags) => ({ path: one(positionals, "path"), property: one(positionals, "property"), quiet: flags["quiet"] === true }),
    },
    {
        route: "update", group: "edit",
        brief: () => "Set a property, or read it",
        positionals: (words, command) => [
            path_positional(words, command, true),
            property_positional(command, true),
            {
                name: "values", placeholder: "value", brief: "Value tokens (omit to read or set a flag)", optional: true, variadic: true,
                slot: prior => ({ kind: "value", command, path: prior[0] ?? "", property: prior[1] ?? "", prior: prior.slice(2) }),
            },
        ],
        flags: quiet_flag("When reading: print only the value. When creating a child node: don't ask"),
        quiet: true,
        implementation: commands => commands.update,
        arguments_: (positionals, flags) => ({
            path: one(positionals, "path"), property: one(positionals, "property"), values: many(positionals, "values"), quiet: flags["quiet"] === true,
        }),
    },
    {
        route: "delete", group: "edit",
        brief: () => "Delete a node or a property",
        positionals: (words, command) => [path_positional(words, command, true), property_positional(command, true)],
        flags: { force: { kind: "boolean", brief: "Delete a node that has children" } },
        implementation: commands => commands.delete,
        arguments_: (positionals, flags) => ({ path: one(positionals, "path"), property: one(positionals, "property"), force: flags["force"] === true }),
    },
    {
        route: "rename", group: "edit",
        brief: () => "Rename a node",
        positionals: (words, command) => [path_positional(words, command, false), { name: "name", placeholder: "name", brief: "New node name" }],
        implementation: commands => commands.rename,
        arguments_: positionals => ({ path: one(positionals, "path"), name: one(positionals, "name") }),
    },
    {
        route: "list devices", group: "edit",
        brief: () => "List the devices, or the ones a filter names",
        positionals: (_words, command) => [{ name: "filter", placeholder: "filter", brief: "Only the devices it names", optional: true, slot: () => ({ kind: "device", command }) }],
        implementation: commands => commands.list?.devices,
        arguments_: positionals => ({ filter: one(positionals, "filter") }),
    },
    {
        route: "list context", group: "edit",
        brief: words => `List what the ${words.workfile} can be built for`,
        positionals: () => [],
        implementation: commands => commands.list?.context,
        arguments_: () => ({}),
    },
    {
        route: "list property", group: "edit",
        brief: () => "List a node's properties, or describe one",
        positionals: (words, command) => [path_positional(words, command, true), property_positional(command, true)],
        implementation: commands => commands.list?.property,
        arguments_: positionals => ({ path: one(positionals, "path"), property: one(positionals, "property") }),
    },
    {
        route: "list value", group: "edit",
        brief: () => "Suggest values for a property",
        positionals: (words, command) => [
            path_positional(words, command, false),
            property_positional(command, false),
            {
                name: "member", placeholder: "member", brief: "A member of a union value", optional: true,
                slot: prior => ({ kind: "value", command, path: prior[0] ?? "", property: prior[1] ?? "", prior: [] }),
            },
        ],
        implementation: commands => commands.list?.value,
        arguments_: positionals => ({ path: one(positionals, "path"), property: one(positionals, "property"), member: one(positionals, "member") }),
    },
    {
        route: "validate", group: "build",
        brief: words => `Validate the ${words.workfile}`,
        positionals: () => [],
        implementation: commands => commands.validate,
        arguments_: () => ({}),
    },
    {
        route: "build", group: "build",
        brief: words => `Build the ${words.workfile}`,
        positionals: () => [],
        implementation: commands => commands.build,
        arguments_: () => ({}),
    },
    {
        route: "deploy", group: "build",
        brief: () => "Deploy the build to the target",
        positionals: () => [],
        implementation: commands => commands.deploy,
        arguments_: () => ({}),
    },
];

/** The shared routes by name, for tests and the contract test. */
export const SHARED_ROUTES: readonly string[] = SHARED.map(definition => definition.route);

/** Placeholders from the backend's `CommandDocumentation`. */
function with_placeholders(positionals: readonly PositionalSpec[], documentation: CommandDocumentation | undefined): PositionalSpec[] {
    return positionals.map(positional => {
        const placeholder = documentation?.placeholders?.[positional.name];
        return placeholder === undefined ? positional : { ...positional, placeholder };
    });
}

/** The backend's flags with the front end's; a backend may not redefine one. */
function merge_flags(route: string, front: FlagSpecs, backend: FlagSpecs | undefined): FlagSpecs {
    for (const name of Object.keys(backend ?? {})) {
        if (name in front || name === "json" || name === "help") { throw new Error(`The backend's flag --${name} of '${route}' is the front end's`); }
    }
    return { ...front, ...backend };
}

/** The flags of `input` that `specs` declares. */
function pick_flags(input: FlagInput, specs: FlagSpecs | undefined): FlagValues<FlagSpecs> {
    const picked: Record<string, unknown> = {};
    for (const name of Object.keys(specs ?? {})) {
        if (input[name] !== undefined) { picked[name] = input[name]; }
    }
    return picked as FlagValues<FlagSpecs>;
}

function shared_route(definition: SharedDefinition, front: FrontEnd): Route {
    const { backend } = front;
    const words = backend?.words ?? DEFAULT_WORDS;
    const implementation = backend === undefined ? undefined : definition.implementation(backend.commands);
    const documentation = implementation?.docs;
    const path = definition.route.split(" ");
    const base = {
        path,
        brief: documentation?.brief ?? definition.brief(words),
        full: documentation?.full,
        examples: documentation?.examples,
        group: definition.group,
        positionals: with_placeholders(definition.positionals(words, definition.route), documentation),
        quiet_flag: definition.quiet === true ? "quiet" : undefined,
        asks: true,
    };
    if (implementation === undefined) {
        const message = backend === undefined
            ? front.backend_problem ?? "No backend is set."
            : `${definition.route} is not supported by the ${backend.id} backend`;
        return {
            ...base,
            flags: definition.flags ?? {},
            hidden: backend !== undefined,
            supported: false,
            run: () => Promise.resolve(input_error(message)),
        };
    }
    return {
        ...base,
        flags: merge_flags(definition.route, definition.flags ?? {}, implementation.flags),
        supported: true,
        run: (input, session) => implementation.run(
            definition.arguments_(input.positionals, input.flags),
            pick_flags(input.flags, implementation.flags),
            session,
        ),
    };
}

function extra_routes(front: FrontEnd): Route[] {
    const extra = front.backend?.extra ?? {};
    return Object.entries(extra).map(([route, command]) => {
        if (SHARED_ROUTES.includes(route)) { throw new Error(`The backend's extra command '${route}' is a shared command`); }
        return {
            path: route.split(" "),
            brief: command.docs.brief,
            full: command.docs.full,
            examples: command.docs.examples,
            group: command.group ?? "edit",
            hidden: command.hidden,
            positionals: with_placeholders(command.positionals, command.docs),
            flags: command.flags ?? {},
            asks: true,
            supported: true,
            run: (input, session) => command.run(input.positionals, pick_flags(input.flags, command.flags), session),
        };
    });
}

/** Every route of this run, in the order of help: by group, the shared ones first. */
export function build_routes(front: FrontEnd): Route[] {
    const routes = [
        config_route(front),
        ...SHARED.map(definition => shared_route(definition, front)),
        ...extra_routes(front),
        completion_route(front),
        ...skill_routes(front),
    ];
    const names = new Set<string>();
    for (const route of routes) {
        const name = route.path.join(" ");
        if (names.has(name)) { throw new Error(`Two routes named '${name}'`); }
        names.add(name);
    }
    return GROUPS.flatMap(group => routes.filter(route => route.group === group));
}

/** The route `words` start with: the longest path that matches, and how many words it took. */
export function find_route(routes: readonly Route[], words: readonly string[]): { route: Route; used: number } | undefined {
    let found: { route: Route; used: number } | undefined;
    for (const route of routes) {
        if (route.path.length <= words.length && route.path.every((segment, index) => words[index] === segment)
            && (found === undefined || route.path.length > found.used)) {
            found = { route, used: route.path.length };
        }
    }
    return found;
}

/** The names that can follow `prefix` (`[]`: the top-level commands), with their briefs, in route order. */
export function next_segments(routes: readonly Route[], prefix: readonly string[]): { name: string; brief: string }[] {
    const seen = new Map<string, string>();
    for (const route of routes) {
        if (route.hidden === true || route.path.length <= prefix.length) { continue; }
        if (!prefix.every((segment, index) => route.path[index] === segment)) { continue; }
        const name = route.path[prefix.length]!;
        if (seen.has(name)) { continue; }
        const is_map = route.path.length > prefix.length + 1;
        seen.set(name, is_map ? ROUTE_MAP_BRIEFS[name] ?? name : route.brief);
    }
    return [...seen].map(([name, brief]) => ({ name, brief }));
}

// =====================================================================================
// The stricli application
// =====================================================================================

export interface RunContext extends CommandContext {
    /** Runs a route once stricli has parsed its words. */
    readonly execute: (route: Route, flags: FlagInput, arguments_: readonly unknown[]) => Promise<void>;
}

function stricli_flag(spec: FlagSpec): unknown {
    const hidden = spec.hidden === true ? { hidden: true } : {};
    switch (spec.kind) {
        case "boolean": { return { kind: "boolean", brief: spec.brief, optional: true, withNegated: false, ...hidden }; }
        case "value": { return { kind: "parsed", parse: String, brief: spec.brief, placeholder: spec.placeholder, optional: true, ...hidden }; }
        case "values": { return { kind: "parsed", parse: String, brief: spec.brief, placeholder: spec.placeholder, optional: true, variadic: ",", ...hidden }; }
    }
}

/** `[--quiet] [--name name] [<path>] [<value>...]`, for a route whose usage stricli can't write (a variadic after others). */
function usage_line(route: Route): string {
    const flags = Object.entries(route.flags).filter(([, spec]) => spec.hidden !== true).map(([name, spec]) => {
        switch (spec.kind) {
            case "boolean": { return `[--${name}]`; }
            case "value": { return `[--${name} ${spec.placeholder}]`; }
            case "values": { return `[--${name} ${spec.placeholder}]...`; }
        }
    });
    const positionals = route.positionals.map(positional => {
        const word = `<${positional.placeholder}>${positional.variadic === true ? "..." : ""}`;
        return positional.optional === true || positional.variadic === true ? `[${word}]` : word;
    });
    return [...flags, ...positionals].join(" ");
}

/** Takes the words stricli parsed back to the positionals' names. */
export function positional_record(specs: readonly PositionalSpec[], arguments_: readonly unknown[]): PositionalValues {
    const record: Record<string, string | readonly string[] | undefined> = {};
    let index = 0;
    for (const spec of specs) {
        if (spec.variadic === true) {
            record[spec.name] = arguments_.slice(index).filter((word): word is string => typeof word === "string");
            index = arguments_.length;
        } else {
            const word = arguments_[index];
            record[spec.name] = typeof word === "string" ? word : undefined;
            index += 1;
        }
    }
    return record;
}

function full_description(route: Route, program: string, listed_arguments: boolean): string | undefined {
    const parts: string[] = [];
    if (route.full !== undefined) { parts.push(route.full); }
    if (listed_arguments && route.positionals.length > 0) {
        const width = Math.max(...route.positionals.map(positional => positional.placeholder.length));
        parts.push(["Arguments:", ...route.positionals.map(positional => `  ${positional.placeholder.padEnd(width)}  ${positional.brief}`)].join("\n"));
    }
    if (route.examples !== undefined && route.examples.length > 0) {
        parts.push(["Examples:", ...route.examples.map(example => `  $ ${program} ${example}`)].join("\n"));
    }
    if (parts.length === 0) { return undefined; }
    return [route.full === undefined ? route.brief : undefined, ...parts].filter(part => part !== undefined).join("\n\n");
}

function stricli_command(route: Route, program: string): RoutingTarget<RunContext> {
    const flags = Object.fromEntries(Object.entries(route.flags).map(([name, spec]) => [name, stricli_flag(spec)]));
    const variadic = route.positionals.some(positional => positional.variadic === true);
    const last = route.positionals.at(-1);
    const positional = variadic && last !== undefined
        ? {
            kind: "array",
            parameter: { placeholder: last.placeholder, brief: last.brief, parse: String },
            minimum: route.positionals.filter(spec => spec.optional !== true && spec.variadic !== true).length,
        }
        : {
            kind: "tuple",
            parameters: route.positionals.map(spec => ({
                placeholder: spec.placeholder, brief: spec.brief, parse: String, ...(spec.optional === true ? { optional: true } : {}),
            })),
        };
    const command = buildCommand<FlagInput, readonly unknown[], RunContext>({
        docs: {
            brief: route.brief,
            fullDescription: full_description(route, program, variadic),
            ...(variadic ? { customUsage: [usage_line(route)] } : {}),
        },
        parameters: { flags, positional } as never,
        async func(this: RunContext, input: FlagInput, ...arguments_: readonly unknown[]) {
            await this.execute(route, input, arguments_);
        },
    });
    // The usage line in the parent's help too, not only in the command's.
    if (variadic) {
        Object.assign(command, { formatUsageLine: (usage: { prefix: readonly string[] }) => `${usage.prefix.join(" ")} ${usage_line(route)}` });
    }
    return command;
}

interface Tree { route?: Route; children: Map<string, Tree> }

function route_map(tree: Tree, name: string | undefined, front: FrontEnd): RouteMap<RunContext> {
    const routes: Record<string, RoutingTarget<RunContext>> = {};
    const hidden: Record<string, boolean> = {};
    for (const [segment, child] of tree.children) {
        if (child.route !== undefined && child.children.size === 0) {
            routes[segment] = stricli_command(child.route, front.program);
            if (child.route.hidden === true) { hidden[segment] = true; }
        } else {
            routes[segment] = route_map(child, segment, front);
            if ([...child.children.values()].every(grandchild => grandchild.route?.hidden === true)) { hidden[segment] = true; }
        }
    }
    const brief = name === undefined ? "Configure device trees and no-OS projects for peripherals" : ROUTE_MAP_BRIEFS[name] ?? name;
    return buildRouteMap({ routes, docs: { brief, fullDescription: name === undefined ? root_description(front) : undefined, hideRoute: hidden } });
}

/** ` Another: 'analog-attach config backend noos'.` (several: `<a|b>`), naming the registered backends but the active one; empty when there is none. */
export function other_backends(front: Pick<FrontEnd, "program" | "registry">, active: string): string {
    const others = Object.keys(front.registry).filter(id => id !== active);
    if (others.length === 0) { return ""; }
    return ` ${others.length === 1 ? "Another" : "Others"}: '${front.program} config backend ${others.length === 1 ? others.join("") : `<${others.join("|")}>`}'.`;
}

function root_description(front: FrontEnd): string {
    const backend = front.backend === undefined
        ? `${front.backend_problem ?? "No backend is set."}`
        : `Backend: ${front.backend.id} (${front.backend.title}).${other_backends(front, front.backend.id)}`;
    return `Configure device trees and no-OS projects for peripherals.\n\n${backend}\n\nAdd --json anywhere for JSON output. '${front.program}' alone on a terminal sets up the project.`;
}

/** The stricli application of `routes`. */
export function build_application(routes: readonly Route[], front: FrontEnd): Application<RunContext> {
    const root: Tree = { children: new Map() };
    for (const route of routes) {
        let node = root;
        for (const segment of route.path) {
            let child = node.children.get(segment);
            if (child === undefined) {
                child = { children: new Map() };
                node.children.set(segment, child);
            }
            node = child;
        }
        node.route = route;
    }
    return buildApplication(route_map(root, undefined, front), {
        name: front.program,
        versionInfo: { currentVersion: front.version },
        scanner: { caseStyle: "original", allowArgumentEscapeSequence: true },
        documentation: { disableAnsiColor: front.streams.stdout.isTTY !== true },
    });
}

/**
 * Our side of the attach-meta tool protocol.
 *
 * attach-meta is a dispatcher that owns a CLI surface but no domain logic: it
 * resolves a tool binary from config, asks it what it can do via
 * `<binary> --json discovery`, and forwards each command to the argv the tool
 * declared for it. Because the argv is ours to declare, attach-meta's canonical
 * keys (`read_property`) can map onto whatever implements them here (`read`)
 * without either side bending to the other.
 *
 * COMMANDS is the single source of truth for route words: src/argv.ts derives its
 * route table from it.
 */

/**
 * Protocol version we implement. attach-meta requires the breaking segment to
 * match its own — under 1.0 semver that is `major.minor`, so `0.2.x` here pairs
 * with attach-meta `0.2.x`. Duplicated across repos by necessity; test/protocol.test.ts
 * pins it so a bump fails loudly instead of drifting.
 */
export const PROTOCOL_VERSION = "0.2.1";

/** Reported as `tool_version`. Keep in step with the version in src/app.ts. */
export const TOOL_VERSION = "0.1.0";

export const TOOL_NAME = "attach-no-os";

export const TOOL_DESCRIPTION = "Analog Attach CLI for no-OS workfiles";

export type CommandEntry = {
    /** Argv attach-meta should invoke for this key. Empty when unsupported. */
    argv: string[];
    supported: boolean;
    description: string;
};

/**
 * Every discovery key attach-meta knows about, including ones we do not implement.
 * Advertising `supported: false` is how a tool says "I speak the protocol but not
 * this verb", which yields a clear error instead of a missing-key one.
 */
export const COMMANDS: Record<string, CommandEntry> = {
    create_workfile: {
        argv: ["create", "workfile"],
        supported: true,
        description: "Create a new workfile",
    },
    create_node: {
        argv: ["create", "node"],
        supported: true,
        description: "Add a new node",
    },
    create_property: {
        // A node's property set comes from its schema; `update` sets values on the
        // properties that already exist.
        argv: [],
        supported: false,
        description: "Not supported — properties are defined by the node's schema",
    },
    read_node: {
        argv: ["read"],
        supported: true,
        description: "Read values of a node",
    },
    read_property: {
        // `aa read <node> [property]` serves both keys; the trailing args decide which.
        argv: ["read"],
        supported: true,
        description: "Read values of a property",
    },
    update: {
        argv: ["update"],
        supported: true,
        description: "Update primitive values",
    },
    delete_node: {
        argv: ["delete"],
        supported: true,
        description: "Delete a node",
    },
    delete_property: {
        argv: ["delete"],
        supported: true,
        description: "Reset a property to its default",
    },
    validate: {
        argv: ["validate"],
        supported: true,
        description: "Validate workfile, node, or property",
    },
    generate: {
        argv: ["generate"],
        supported: true,
        description: "Generate a no-OS project from the workfile",
    },
    build: {
        argv: ["build"],
        supported: true,
        description: "Build a no-OS project",
    },
    deploy: {
        argv: ["deploy"],
        supported: true,
        description: "Deploy a no-OS project",
    },
    config: {
        argv: ["config"],
        supported: true,
        description: "Manage CLI settings",
    },
    init: {
        // Alias, not a second code path: initializing a workfile is `create workfile`.
        argv: ["create", "workfile"],
        supported: true,
        description: "Initialize a new workfile (alias of create workfile)",
    },
    list_devices: {
        // `create node` with no schema argument lists every schema it could add.
        argv: ["create", "node"],
        supported: true,
        description: "List available device schemas",
    },
    complete: {
        argv: ["complete"],
        supported: true,
        description: "Return completion candidates for a discovery key",
    },
};

/**
 * Route words to complete against, given a discovery key (`create_node`) or a
 * literal route word (`create`). Both forms are accepted so attach-meta and
 * completion/aa.bash can share one entrypoint.
 *
 * Returns `[]` for no token (complete the top-level routes) and `undefined` for a
 * key we advertise as unsupported (offer nothing).
 */
export function resolve_route(token: string | undefined): string[] | undefined {
    if (!token) {
        return [];
    }

    const entry = COMMANDS[token];
    if (!entry) {
        return [token];
    }

    return entry.supported ? entry.argv : undefined;
}

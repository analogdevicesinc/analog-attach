import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proposeCompletions } from "@stricli/core";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import {
    PROTOCOL_VERSION,
    SUGGEST_KINDS,
    build_manifest,
    type Manifest,
} from "../src/protocol/manifest";

/**
 * attach-meta validates our manifest against this meta-schema at init time and again
 * whenever the file's hash changes, so a drift here is a registration failure rather than
 * a bad response. Validating it in a unit test is what turns that into a red test.
 *
 * The schema lives in the attach-meta repository, not this one. When that checkout is not
 * next door the schema-shaped assertions are skipped and only the invariants we can state
 * without it are checked.
 */
const META_SCHEMA_PATH = find_meta_schema();

/** What attach-meta refuses to register without (`required` in the meta-schema). */
const REQUIRED_COMMANDS = [
    "tool-config-get",
    "tool-config-set",
    "create-workfile",
    "list-devices",
    "add",
    "read",
    "update",
    "delete",
    "validate",
];

/**
 * The manifest as attach-meta sees it: it reads the file we wrote, so anything
 * JSON.stringify drops (a `timeout_ms: undefined`, meaning "no timeout") is not there to
 * validate.
 */
function written_manifest(): Manifest {
    return JSON.parse(JSON.stringify(build_manifest())) as Manifest;
}

function find_meta_schema(): string | undefined {
    const candidates = [
        process.env.AA_META_SCHEMA,
        path.resolve(import.meta.dirname, "../../../../aa-meta/docs/schemas/manifest.schema.json"),
        path.resolve(os.homedir(), "adi/aa-meta/docs/schemas/manifest.schema.json"),
    ];

    return candidates.find((candidate): candidate is string =>
        candidate !== undefined && fs.existsSync(candidate));
}

describe("manifest", () => {
    it("declares the protocol major attach-meta 1.x requires", () => {
        // attach-meta's check_major_match compares this against its own crate major and
        // refuses the tool outright on a mismatch.
        expect(PROTOCOL_VERSION.split(".")[0]).toBe("1");
        expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("declares every command attach-meta requires", () => {
        const declared = Object.keys(written_manifest().commands);
        for (const command of REQUIRED_COMMANDS) {
            expect(declared, `${command} is mandatory`).toContain(command);
        }
    });

    it("declares move, so aa-meta never runs its destructive fallback", () => {
        // With `move` absent, aa-meta emulates it as read → add → update → delete --force,
        // which cannot work on a flat symbol table and would leave the workfile rewritten.
        expect(Object.keys(written_manifest().commands)).toContain("move");
    });

    it("leaves alias undeclared, since aa-meta refuses it harmlessly", () => {
        expect(Object.keys(written_manifest().commands)).not.toContain("alias");
    });

    it("ends every argv in --json so the protocol path never gets the human rendering", () => {
        // Nothing is ever inserted into our argv, only appended, so --json has to be the
        // last word we declare.
        for (const [name, mapping] of Object.entries(written_manifest().commands)) {
            expect(mapping!.argv.length, `${name} has an empty argv`).toBeGreaterThan(0);
            expect(mapping!.argv.at(-1), `${name} does not force JSON`).toBe("--json");
        }
    });

    it("describes every command, since that is what agents read", () => {
        for (const [name, mapping] of Object.entries(written_manifest().commands)) {
            expect(mapping!.description, `${name} has no description`).toBeTruthy();
        }
    });

    it("names positional completions after the command, not after the schema field", () => {
        // aa-meta looks up a positional's kind as completions[arg == subcommand]; the
        // base schema's `x-positional` field name never appears in a lookup, so naming a
        // completion after it (`key`, `path`) silently completes nothing.
        const flags_by_command: Record<string, string[]> = {
            add: ["to"],
            update: ["with"],
            move: ["to"],
        };

        for (const [name, mapping] of Object.entries(written_manifest().commands)) {
            const flags = flags_by_command[name] ?? [];
            for (const completion of mapping!.completions ?? []) {
                expect(
                    [name, ...flags],
                    `${name} completes '${completion.arg}', which is neither the command nor one of its flags`,
                ).toContain(completion.arg);
            }
        }
    });

    it("only uses completion kinds that list-intelligence advertises", () => {
        // An unadvertised kind is not an error in aa-meta — it silently returns no
        // candidates, which is a bug that never announces itself at runtime.
        const advertised: string[] = Object.values(SUGGEST_KINDS);
        for (const [name, mapping] of Object.entries(written_manifest().commands)) {
            for (const completion of mapping!.completions ?? []) {
                expect(advertised, `${name} completes '${completion.arg}' with an unknown kind`)
                    .toContain(completion.kind);
            }
        }
    });

    it("names a real route for every command", async () => {
        const routes = await proposeCompletions(app, [""], { process });
        const names = routes.map(route => route.completion);

        for (const [name, mapping] of Object.entries(written_manifest().commands)) {
            // argv is `<interpreter> <script> <route> --json`.
            expect(names, `${name} maps to a route the app does not have`)
                .toContain(mapping!.argv.at(-2));
        }
    });

    it.skipIf(META_SCHEMA_PATH === undefined)(
        "validates against attach-meta's meta-schema",
        () => {
            const schema = JSON.parse(fs.readFileSync(META_SCHEMA_PATH!, "utf8"));
            // strict: false — the meta-schema $refs the draft 2020-12 meta-schema for its
            // `args` fragment, which trips ajv's strict-mode checks on keywords it cannot
            // see through.
            const ajv = new Ajv2020({ strict: false, allErrors: true });
            const validate = ajv.compile(schema);

            const valid = validate(written_manifest());
            // Asserted before the boolean so a failure reports what is actually wrong.
            expect(validate.errors ?? []).toEqual([]);
            expect(valid).toBe(true);
        }
    );
});

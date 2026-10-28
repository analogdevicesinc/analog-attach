import fs from "node:fs";
import path from "node:path";
import { buildCommand } from "@stricli/core";
import { get_workfile_path, import_minimal, load_minimal_workfile, validate_workfile } from "attach-no-os-lib";
import { common_ok, type ImportResponse } from "../protocol/responses";
import { output, output_error } from "./shared";

type ImportFlags = {
    json?: boolean;
};

/**
 * `attach-noos import <path>` — start from an existing workfile.
 *
 * The file is copied, as it is, to where the `workfile` setting points, so every command
 * works on it from there. It is checked first: a file that does not load with the
 * configured modules (a schema they do not provide, a value its schema rejects) is refused,
 * and nothing is copied. Like `init`, it never overwrites a workfile.
 */
export const importCommand = buildCommand<ImportFlags, [string]>({
    docs: {
        brief: "Start from an existing workfile",
        fullDescription:
            "Copies <path> to the workfile the 'workfile' setting names, after checking that it loads\n" +
            "with the configured modules. Refuses to overwrite a workfile that already exists."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "path", brief: "The workfile to start from", parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, source_argument) => {
        const source = path.resolve(source_argument);
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            output_error(flags, `No workfile at '${source}'`);
            return;
        }

        const target = get_workfile_path();
        if (!target.ok) {
            output_error(flags, target.error.message);
            return;
        }
        if (source === target.value) {
            output_error(flags, `'${source}' is already the workfile`);
            return;
        }
        if (fs.existsSync(target.value)) {
            output_error(
                flags,
                `A workfile already exists at ${target.value}`,
                { text: `A workfile already exists at ${target.value}.\nDelete it, or point the 'workfile' setting somewhere else.` }
            );
            return;
        }

        // What it describes has to resolve here, or every command after would fail on it.
        const minimal = load_minimal_workfile(source);
        if (!minimal.ok) {
            output_error(flags, `Cannot import '${source}': ${minimal.error.message}`);
            return;
        }
        const workfile = import_minimal(minimal.value);
        if (!workfile.ok) {
            output_error(flags, `Cannot import '${source}': ${workfile.error.message}`);
            return;
        }

        fs.mkdirSync(path.dirname(target.value), { recursive: true });
        fs.copyFileSync(source, target.value);

        const validation = validate_workfile(workfile.value);
        const errors = validation.errors.filter(entry => entry.severity === "error").length;
        const target_of = minimal.value.board === undefined
            ? `platform ${minimal.value.platform}`
            : `board ${minimal.value.board} (platform ${minimal.value.platform})`;
        const nodes = Object.keys(minimal.value.symbols).length;
        const state = validation.valid ? "the workfile is valid" : `${errors} problem${errors === 1 ? "" : "s"} left - run: attach-noos validate`;
        const message = `Imported a workfile for ${target_of}, ${nodes} node${nodes === 1 ? "" : "s"}; ${state}`;

        const response: ImportResponse = { ...common_ok(message), path: target.value, source };
        output(flags, `${message}\n  ${source} -> ${target.value}`, response);
    }
});

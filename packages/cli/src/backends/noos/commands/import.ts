import fs from "node:fs";
import path from "node:path";
import { get_workfile_path, import_minimal, load_minimal_workfile, validate_workfile } from "attach-no-os-lib";
import { answer, command, refuse, type ImportArguments } from "../../../interface/backend-interface";
import { common_ok, type ImportResponse } from "../protocol/responses";
import { install } from "../settings";

/**
 * `import <path>`: start from an existing workfile.
 *
 * The file is copied, as it is, to where the `workfile` setting points, so every command
 * works on it from there. It is checked first: a file that does not load with the
 * configured modules (a schema they do not provide, a value its schema rejects) is refused,
 * and nothing is copied. Like `init`, it never overwrites a workfile.
 */
export const import_command = command<ImportArguments, ImportResponse>({
    docs: {
        brief: "Start from an existing workfile",
        full:
            "Copies <source> to the workfile the 'workfile' setting names, after checking that it loads\n" +
            "with the configured modules. Refuses to overwrite a workfile that already exists."
    },
    run({ source: source_argument }, _flags, session) {
        install(session);
        const source = path.resolve(session.cwd, source_argument);
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            return Promise.resolve(refuse(`No workfile at '${source}'`));
        }

        const target = get_workfile_path();
        if (!target.ok) {
            return Promise.resolve(refuse(target.error.message));
        }
        if (source === target.value) {
            return Promise.resolve(refuse(`'${source}' is already the workfile`));
        }
        if (fs.existsSync(target.value)) {
            return Promise.resolve(refuse(
                `A workfile already exists at ${target.value}`,
                { text: `A workfile already exists at ${target.value}.\nDelete it, or point the 'workfile' setting somewhere else.` }
            ));
        }

        // What it describes has to resolve here, or every command after would fail on it.
        const minimal = load_minimal_workfile(source);
        if (!minimal.ok) {
            return Promise.resolve(refuse(`Cannot import '${source}': ${minimal.error.message}`));
        }
        const workfile = import_minimal(minimal.value);
        if (!workfile.ok) {
            return Promise.resolve(refuse(`Cannot import '${source}': ${workfile.error.message}`));
        }

        fs.mkdirSync(path.dirname(target.value), { recursive: true });
        fs.copyFileSync(source, target.value);

        const validation = validate_workfile(workfile.value);
        const errors = validation.errors.filter(entry => entry.severity === "error").length;
        const target_of = minimal.value.board === undefined
            ? `platform ${minimal.value.platform}`
            : `board ${minimal.value.board} (platform ${minimal.value.platform})`;
        const nodes = Object.keys(minimal.value.symbols).length;
        const state = validation.valid
            ? "the workfile is valid"
            : `${String(errors)} problem${errors === 1 ? "" : "s"} left - run: ${session.program} validate`;
        const message = `Imported a workfile for ${target_of}, ${String(nodes)} node${nodes === 1 ? "" : "s"}; ${state}`;

        const response: ImportResponse = { ...common_ok(message), path: target.value, source };
        return Promise.resolve(answer(response, `${message}\n  ${source} -> ${target.value}`));
    }
});

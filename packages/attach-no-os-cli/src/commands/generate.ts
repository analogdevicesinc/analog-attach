import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    configured_template_set,
    example_enabled,
    generate_project,
    get_setting_value,
    list_template_sets,
    resolve_board,
} from "attach-no-os-lib";
import { filter_completions, get_board_names } from "../completion/completion";
import type { AttachContext } from "./shared";
import {
    get_project_name,
    get_project_path,
    load_context,
    output,
    output_error,
} from "./shared";
import { common_ok } from "../protocol/responses";

type GenerateFlags = {
    json?: boolean;
    output?: string;
    templateSet?: string;
    board?: string;
};

/**
 * `attach-noos generate` — render the workfile into a CAPI project.
 *
 * Everything it needs is configuration: the project name, where to write it, which board and
 * which template set. The flags stay as human overrides, but nothing is required on the
 * command line, because attach-meta calls this with no arguments at all.
 */
export const generateCommand = buildCommand<GenerateFlags, [], AttachContext>({
    docs: {
        brief: "Generate a CAPI project from the workfile",
        fullDescription:
            "Renders the workfile into the project directory: the 'project_path' setting, or\n" +
            "out/<project_name> when it is unset. --output overrides it for this run."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            output: {
                kind: "parsed",
                brief: "Project directory to write (default: the 'project_path' setting, else out/<project_name>)",
                optional: true,
                parse: String
            },
            templateSet: {
                kind: "parsed",
                brief: "Template set to render with (default: the 'template_set' setting)",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(list_template_sets(), partial);
                }
            },
            board: {
                kind: "parsed",
                brief: "Board preset to build for (default: the workfile board, else the only board for its platform)",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_board_names(), partial);
                }
            },
        }
    },
    func: async (flags: GenerateFlags) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        const capi_path = get_setting_value("capi_path");
        if (!capi_path.ok) {
            output_error(flags, "capi_path is not configured. Run: attach-noos tool-config-set capi_path <path>");
            return;
        }

        const platform_vendor = context.value.workfile.platform_vendor;
        if (!platform_vendor) {
            output_error(flags, "Platform vendor not found in workfile");
            return;
        }

        // The generated project names one board, so it is settled here rather than left
        // to the templates: the flag wins, then the workfile, then the chip if exactly one
        // board carries it.
        const board = resolve_board(
            context.value.minimal.platform,
            flags.board ?? context.value.minimal.board,
        );
        if (!board.ok) {
            output_error(flags, board.error.message);
            return;
        }

        const project_name = get_project_name(context.value);
        if (!project_name.ok) {
            output_error(flags, project_name.error.message);
            return;
        }

        // The same directory build and deploy act on, unless this run names another.
        const configured_project = get_project_path();
        if (!configured_project.ok) {
            output_error(flags, configured_project.error.message);
            return;
        }
        const project_path = flags.output === undefined
            ? configured_project.value
            : path.resolve(process.cwd(), flags.output);

        const result = generate_project({
            workfile: context.value.workfile,
            platform_name: context.value.minimal.platform,
            platform_vendor: platform_vendor,
            board: board.value,
            project_name: project_name.value,
            project_path: project_path,
            capi_path: capi_path.value,
            template_set: flags.templateSet,
            example: example_enabled(),
        });

        if (!result.ok) {
            output_error(flags, result.error.message);
            return;
        }

        // Which template set produced the project is worth reporting now that it
        // is configurable - the same workfile can generate different output.
        const template_set = flags.templateSet ?? configured_template_set();
        const files = result.value.files_created;

        const message = `Generated '${project_name.value}' in ${project_path}`
            + ` (board: ${board.value.name}, templates: ${template_set}, ${files.length} file${files.length === 1 ? "" : "s"})`;

        const text = `Generated project '${project_name.value}' (board: ${board.value.name}, templates: ${template_set})\n\n`
            + "  Files created:\n"
            + files.map(file => `    ${file}`).join("\n")
            + `\n\n  ${files.length} file${files.length === 1 ? "" : "s"} created`;

        output(flags, text, common_ok(message));
    }
});

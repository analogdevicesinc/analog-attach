import { buildCommand } from "@stricli/core";
import {
    configured_template_set,
    generate_project,
    get_setting_value,
    list_template_sets,
    resolve_board,
} from "attach-no-os-lib";
import { filter_completions, get_board_names } from "../completion/completion";
import type { AttachContext } from "./shared";
import {
    load_context,
    get_platform_specs,
    output,
    output_error,
} from "./shared";

export const generateCommand = buildCommand<
    { json?: boolean; output?: string; templateSet?: string; board?: string },
    [string],
    AttachContext
>({
    docs: { brief: "Generate a no-OS project from the workfile" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "project_name", brief: "Name of the project", parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            output: { kind: "parsed", brief: "Output directory (default: current directory)", optional: true, parse: String },
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
                brief: "no-OS board preset to build for (default: the workfile board, else the only board for its platform)",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_board_names(), partial);
                }
            },
        }
    },
    func: async function (flags, project_name) {
        const context = load_context(this.workfile_path);
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        const noos_path = get_setting_value("no_os_path");
        if (!noos_path.ok) {
            output_error(flags, "config_missing", "no_os_path is not configured. Run: aa config no_os_path <path>");
            return;
        }

        const platform_vendor = context.value.workfile.platform_vendor;
        if (!platform_vendor) {
            output_error(flags, "vendor_missing", "Platform vendor not found in workfile");
            return;
        }

        const specs = get_platform_specs();
        if (!specs.ok) {
            output_error(flags, "cannot_list_platforms", specs.error.message);
            return;
        }

        // The generated CMakeLists.txt and project.conf name one board, so it is
        // settled here rather than left to the templates: the flag wins, then the
        // workfile, then the platform if exactly one board belongs to it.
        const board = resolve_board(
            noos_path.value,
            context.value.minimal.platform,
            specs.value,
            flags.board ?? context.value.minimal.board,
        );
        if (!board.ok) {
            output_error(flags, "board_unresolved", board.error.message);
            return;
        }

        const output_path = flags.output ?? process.cwd();

        const result = generate_project({
            workfile: context.value.workfile,
            platform_name: context.value.minimal.platform,
            platform_vendor: platform_vendor,
            board: board.value,
            project_name: project_name,
            output_path: output_path,
            noos_path: noos_path.value,
            template_set: flags.templateSet,
        });

        if (!result.ok) {
            output_error(flags, "generate_failed", result.error.message);
            return;
        }

        // Which template set produced the project is worth reporting now that it
        // is configurable — the same workfile can generate different output.
        const template_set = flags.templateSet ?? configured_template_set();

        const text = `Generated project '${project_name}' (board: ${board.value.name}, templates: ${template_set})\n\n` +
            `  Files created:\n` +
            result.value.files_created.map(f => `    ${f}`).join("\n") +
            `\n\n  ${result.value.files_created.length} files created`;

        const json = {
            project: project_name,
            output_path: output_path,
            board: board.value.name,
            template_set: template_set,
            files_created: result.value.files_created
        };

        output(flags, text, json);
    }
});

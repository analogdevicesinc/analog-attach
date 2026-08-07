import { buildCommand } from "@stricli/core";
import {
    generate_project,
    get_setting_value,
} from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    output,
    output_error,
} from "./shared";

export const generateCommand = buildCommand<
    { json?: boolean; output?: string },
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

        const output_path = flags.output ?? process.cwd();

        const result = generate_project({
            workfile: context.value.workfile,
            platform_name: context.value.minimal.platform,
            platform_vendor: platform_vendor,
            project_name: project_name,
            output_path: output_path,
            noos_path: noos_path.value,
        });

        if (!result.ok) {
            output_error(flags, "generate_failed", result.error.message);
            return;
        }

        const text = `Generated project '${project_name}'\n\n` +
            `  Files created:\n` +
            result.value.files_created.map(f => `    ${f}`).join("\n") +
            `\n\n  ${result.value.files_created.length} files created`;

        const json = {
            project: project_name,
            output_path: output_path,
            files_created: result.value.files_created
        };

        output(flags, text, json);
    }
});

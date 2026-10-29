import path from "node:path";
import {
    configured_template_set,
    example_enabled,
    generate_project,
    get_setting_value,
    resolve_board,
} from "attach-no-os-lib";
import { answer, refuse, type ExtraCommand, type FlagSpecs, type FlagValues, type Outcome, type Session } from "../../../interface/backend-interface";
import { get_project_name, get_project_path, load_context } from "./shared";
import { common_ok, type CommonResponse } from "../protocol/responses";

const GENERATE_FLAGS = {
    "output": {
        kind: "value",
        brief: "Project directory to write (default: the 'project-path' setting, else out/<project-name>)",
        placeholder: "directory",
    },
    "project-template": {
        kind: "value",
        brief: "Template set to render with (default: the 'project-template' setting)",
        placeholder: "template",
    },
    "board": {
        kind: "value",
        brief: "Board preset to build for (default: the workfile board, else the only board for its platform)",
        placeholder: "board",
    },
} as const satisfies FlagSpecs;

/**
 * `generate`: render the workfile into a CAPI project.
 *
 * Everything it needs is configuration: the project name, where to write it, which board and
 * which template set. The flags stay as human overrides, but nothing is required on the
 * command line, so a tool can call it with no arguments at all.
 */
export const generate: ExtraCommand<typeof GENERATE_FLAGS, CommonResponse> = {
    docs: {
        brief: "Generate a CAPI project from the workfile",
        full:
            "Renders the workfile into the project directory: the 'project-path' setting, or\n" +
            "out/<project-name> when it is unset. --output overrides it for this run."
    },
    positionals: [],
    flags: GENERATE_FLAGS,
    group: "build",
    schema: "generate.schema.json",
    run(_arguments, flags, session) {
        return Promise.resolve(run_generate(flags, session));
    }
};

function run_generate(flags: FlagValues<typeof GENERATE_FLAGS>, session: Session): Outcome<CommonResponse> {
    const context = load_context(session);
    if (!context.ok) {
        return refuse(context.error.message);
    }

    const capi_path = get_setting_value("capi-path");
    if (!capi_path.ok) {
        return refuse(`capi-path is not configured. Run: ${session.program} config capi-path <path>`);
    }

    const platform_vendor = context.value.workfile.platform_vendor;
    if (platform_vendor === undefined || platform_vendor === "") {
        return refuse("Platform vendor not found in workfile");
    }

    // The generated project names one board, so it is settled here rather than left
    // to the templates: the flag wins, then the workfile, then the chip if exactly one
    // board carries it.
    const board = resolve_board(
        context.value.minimal.platform,
        flags.board ?? context.value.minimal.board,
    );
    if (!board.ok) {
        return refuse(board.error.message);
    }

    const project_name = get_project_name(context.value);
    if (!project_name.ok) {
        return refuse(project_name.error.message);
    }

    // The same directory build and deploy act on, unless this run names another.
    const configured_project = get_project_path(session);
    if (!configured_project.ok) {
        return refuse(configured_project.error.message);
    }
    const project_path = flags.output === undefined
        ? configured_project.value
        : path.resolve(session.cwd, flags.output);

    const result = generate_project({
        workfile: context.value.workfile,
        platform_name: context.value.minimal.platform,
        platform_vendor: platform_vendor,
        board: board.value,
        project_name: project_name.value,
        project_path: project_path,
        capi_path: capi_path.value,
        template_set: flags["project-template"],
        example: example_enabled(),
    });

    if (!result.ok) {
        return refuse(result.error.message);
    }

    // Which template set produced the project is worth reporting now that it
    // is configurable - the same workfile can generate different output.
    const template_set = flags["project-template"] ?? configured_template_set();
    const files = result.value.files_created;

    const message = `Generated '${project_name.value}' in ${project_path}`
        + ` (board: ${board.value.name}, templates: ${template_set}, ${String(files.length)} file${files.length === 1 ? "" : "s"})`;

    const text = `Generated project '${project_name.value}' (board: ${board.value.name}, templates: ${template_set})\n\n`
        + "  Files created:\n"
        + files.map(file => `    ${file}`).join("\n")
        + `\n\n  ${String(files.length)} file${files.length === 1 ? "" : "s"} created`;

    return answer(common_ok(message), text);
}

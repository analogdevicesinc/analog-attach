import { Command } from "commander";
import { name, version, description } from "../package.json";
import type { LocalContext } from "./context";

import { build_config_command } from "./commands/config/command";
import { build_init_command } from "./commands/init/command";
import { build_add_command } from "./commands/add/command";
import { build_import_command } from "./commands/import/command";
import { build_read_command } from "./commands/read/command";
import { build_update_command } from "./commands/update/command";
import { build_delete_command } from "./commands/delete/command";
import { build_validate_command } from "./commands/validate/command";
import { build_move_command } from "./commands/move/command";
import { build_rename_command } from "./commands/rename/command";
import { build_list_command } from "./commands/list/command";
import { build_internal_list_command } from "./commands/list/internal";
import { build_build_command } from "./commands/build/command";
import { build_deploy_command } from "./commands/deploy/command";
import { build_enable_command, build_disable_command } from "./commands/enable-disable/command";
import { build_install_skill_command } from "./commands/skill/install-skill";
import { build_uninstall_skill_command } from "./commands/skill/uninstall-skill";
import { build_completion_command } from "./commands/completion/command";
import { build_ui_command } from "./commands/ui/command";

export function buildApp(context: LocalContext): Command {
    const program = new Command();
    program
        .name(name)
        .description(description)
        .version(version)
        .allowUnknownOption(false)
        .helpCommand(false)
        .configureHelp({
            visibleOptions: (cmd) => cmd.options.filter(o => !o.hidden),
            commandUsage: (cmd) => {
                const visible = cmd.options.filter(o => !o.hidden);
                const commands = cmd.commands.some(c => !(c as any)._hidden) ? ["[command]"] : [];
                const parts = [...commands, ...(visible.length > 0 ? ["[options]"] : [])];
                return cmd.name() + (parts.length > 0 ? " " + parts.join(" ") : "");
            },
            subcommandTerm: (cmd) => {
                const arguments_ = cmd.registeredArguments.map(a =>
                    a.required ? `<${a.name()}>` : `[${a.name()}${a.variadic ? "..." : ""}]`,
                );
                const visible = cmd.options.filter(o => !o.hidden);
                const parts = [...arguments_, ...(visible.length > 0 ? ["[options]"] : [])];
                return cmd.name() + (parts.length > 0 ? " " + parts.join(" ") : "");
            },
        })
        .addHelpText("after", `
Getting started:
  Run 'attach-linux' with no arguments (or 'attach-linux init') to set up a
  workspace: the Linux tree, the base devicetree and the overlay file.

All commands accept --json for machine-readable output.
Run any command with --help for detailed usage.`);

    // hidden
    program.addCommand(build_internal_list_command(context), { hidden: true });
    program.addCommand(build_ui_command(context), { hidden: true });

    // setup & discovery
    program.addCommand(build_init_command(context));
    program.addCommand(build_list_command(context));

    // overlay editing
    program.addCommand(build_add_command(context));
    program.addCommand(build_import_command(context));
    program.addCommand(build_read_command(context));
    program.addCommand(build_update_command(context));
    program.addCommand(build_delete_command(context));
    program.addCommand(build_move_command(context));
    program.addCommand(build_rename_command(context));
    program.addCommand(build_enable_command(context));
    program.addCommand(build_disable_command(context));

    // build & deploy
    program.addCommand(build_build_command(context));
    program.addCommand(build_validate_command(context));
    program.addCommand(build_deploy_command(context));

    // configuration
    program.addCommand(build_config_command(context));

    // tooling
    program.addCommand(build_install_skill_command(context));
    program.addCommand(build_uninstall_skill_command(context));
    program.addCommand(build_completion_command(context));

    const helpConfig = {
        visibleOptions: (cmd: Command) => cmd.options.filter(o => !o.hidden),
        commandUsage: (cmd: Command) => {
            const visible = cmd.options.filter(o => !o.hidden);
            const arguments_ = cmd.registeredArguments.map(a =>
                a.required ? `<${a.name()}>` : `[${a.name()}${a.variadic ? "..." : ""}]`,
            );
            const parts = [
                ...arguments_,
                ...(visible.length > 0 ? ["[options]"] : []),
            ];
            let prefix = "";
            for (let p = cmd.parent; p; p = p.parent) { prefix = p.name() + " " + prefix; }
            return prefix + cmd.name() + (parts.length > 0 ? " " + parts.join(" ") : "");
        },
    };
    for (const cmd of program.commands) {
        cmd.configureHelp(helpConfig);
    }

    return program;
}

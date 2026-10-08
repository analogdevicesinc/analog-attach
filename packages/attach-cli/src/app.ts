import { Command } from "commander";
import { name, version, description } from "../package.json";
import type { LocalContext } from "./context";

import { build_attach_manifest_command } from "./commands/attach-manifest/command";
import { build_config_get_command } from "./commands/config-get/command";
import { build_config_set_command } from "./commands/config-set/command";
import { build_create_workfile_command } from "./commands/create-workfile/command";
import { build_add_command } from "./commands/add/command";
import { build_read_command } from "./commands/read/command";
import { build_update_command } from "./commands/update/command";
import { build_delete_command } from "./commands/delete/command";
import { build_validate_command } from "./commands/validate2/command";
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

export function buildApp(context: LocalContext): Command {
    const program = new Command();
    program
        .name(name)
        .description(description)
        .version(version)
        .allowUnknownOption(false);

    // protocol commands
    program.addCommand(build_attach_manifest_command(context));
    program.addCommand(build_config_get_command(context));
    program.addCommand(build_config_set_command(context));
    program.addCommand(build_create_workfile_command(context));
    program.addCommand(build_add_command(context));
    program.addCommand(build_read_command(context));
    program.addCommand(build_update_command(context));
    program.addCommand(build_delete_command(context));
    program.addCommand(build_validate_command(context));
    program.addCommand(build_move_command(context));
    program.addCommand(build_rename_command(context));
    program.addCommand(build_list_command(context));
    program.addCommand(build_internal_list_command(context), { hidden: true });
    program.addCommand(build_build_command(context));
    program.addCommand(build_deploy_command(context));

    // human-only commands
    program.addCommand(build_enable_command(context));
    program.addCommand(build_disable_command(context));

    // skill + completion management
    program.addCommand(build_install_skill_command(context));
    program.addCommand(build_uninstall_skill_command(context));
    program.addCommand(build_completion_command(context));

    return program;
}

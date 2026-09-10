import { Command } from "commander";
import { name, version, description } from "../package.json";
import type { LocalContext } from "./context";

import { build_attach_manifest_command } from "./commands/attach-manifest/command";
import { build_config_get_command } from "./commands/config-get/command";
import { build_config_set_command } from "./commands/config-set/command";
import { build_create_workfile_command } from "./commands/create-workfile/command";
import { build_list_devices_command } from "./commands/list-devices/command";
import { build_add_command } from "./commands/add/command";
import { build_read_command } from "./commands/read/command";
import { build_update_command } from "./commands/update/command";
import { build_delete_command } from "./commands/delete/command";
import { build_validate_command } from "./commands/validate/command";
import { build_validate2_command } from "./commands/validate2/command";
import { build_move_command } from "./commands/move/command";
import { build_rename_command } from "./commands/rename/command";
import { build_list_intelligence_command } from "./commands/list-intelligence/command";
import { build_suggest_command } from "./commands/suggest/command";
import { build_init_command } from "./commands/init/command";
import { build_create_command } from "./commands/create/command";
import { build_get_schema_command } from "./commands/get-schema/command";
import { build_suggest_parents_command } from "./commands/suggest-parents/command";
import { build_get_property_command } from "./commands/get-prop/command";
import { build_unset_property_command } from "./commands/unset-prop/command";
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
    program.addCommand(build_list_devices_command(context));
    program.addCommand(build_add_command(context));
    program.addCommand(build_read_command(context));
    program.addCommand(build_update_command(context));
    program.addCommand(build_delete_command(context));
    program.addCommand(build_validate_command(context));
    program.addCommand(build_validate2_command(context));
    program.addCommand(build_move_command(context));
    program.addCommand(build_rename_command(context));
    program.addCommand(build_list_intelligence_command(context));
    program.addCommand(build_suggest_command(context));

    // human-only commands
    program.addCommand(build_init_command(context));
    program.addCommand(build_create_command(context));
    program.addCommand(build_get_schema_command(context));
    program.addCommand(build_suggest_parents_command(context));
    program.addCommand(build_get_property_command(context));
    program.addCommand(build_unset_property_command(context));
    program.addCommand(build_enable_command(context));
    program.addCommand(build_disable_command(context));

    // skill + completion management
    program.addCommand(build_install_skill_command(context));
    program.addCommand(build_uninstall_skill_command(context));
    program.addCommand(build_completion_command(context));

    return program;
}

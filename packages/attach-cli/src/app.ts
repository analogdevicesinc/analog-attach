import { buildApplication, buildRouteMap } from "@stricli/core";
import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";
import { name, version, description } from "../package.json";
import { list_devices_command } from "./commands/list-devices/command";
import { get_schema_command } from "./commands/get-schema/command";
import { suggest_parents_command } from "./commands/suggest-parents/command";
import { create_command } from "./commands/create/command";
import { validate_command } from "./commands/validate/command";

const routes = buildRouteMap({
    routes: {
        listDevices: list_devices_command,
        getSchema: get_schema_command,
        suggestParents: suggest_parents_command,
        create: create_command,
        validate: validate_command,
        install: buildInstallCommand("attach", { bash: "__attach_bash_complete" }),
        uninstall: buildUninstallCommand("attach", { bash: true }),
    },
    docs: {
        brief: description,
        hideRoute: {
            install: true,
            uninstall: true,
        },
    },
});

export const app = buildApplication(routes, {
    name,
    versionInfo: {
        currentVersion: version,
    },
    scanner: {
        caseStyle: "allow-kebab-for-camel"
    }
});

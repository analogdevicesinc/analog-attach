import { buildApplication, buildRouteMap } from "@stricli/core";
import { buildInstallCommand, buildUninstallCommand } from "@stricli/auto-complete";
import { name, version, description } from "../package.json";
import { list_devices_command } from "./commands/list-devices/command";

const routes = buildRouteMap({
    routes: {
        list_devices: list_devices_command,
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

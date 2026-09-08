import { buildCommand } from "@stricli/core";
import * as fs from "node:fs";
import path from "node:path";

export const attach_manifest_command = buildCommand({
    parameters: {},
    docs: {
        brief: "Write the attach-meta manifest and print its path to stdout",
    },
    async func() {
        const manifest = {
            protocol_version: "1.0.0",
            commands: {
                "tool-config-get": {
                    argv: ["attach", "--json", "config-get"],
                },
                "tool-config-set": {
                    argv: ["attach", "--json", "config-set"],
                },
                "create-workfile": {
                    argv: ["attach", "--json", "create-workfile"],
                    args: {
                        properties: {
                            compatible: { type: "string" },
                            parent: { type: "string" },
                            label: { type: "string" },
                        },
                    },
                },
                "list-devices": {
                    argv: ["attach", "--json", "list-devices"],
                    args: {
                        properties: {
                            "includes-word": { type: "string" },
                        },
                    },
                },
                "add": {
                    argv: ["attach", "--json", "add"],
                    args: {
                        properties: {
                            label: { type: "string" },
                        },
                    },
                    completions: [
                        {
                            arg: "key",
                            kind: "device-key"
                        }
                    ]
                },
                "read": {
                    argv: ["attach", "--json", "read"],
                },
                "update": {
                    argv: ["attach", "--json", "update"],
                },
                "delete": {
                    argv: ["attach", "--json", "delete"],
                },
                "validate": {
                    argv: ["attach", "--json", "validate"],
                },
                "move": {
                    argv: ["attach", "--json", "move"],
                },
                "rename": {
                    argv: ["attach", "--json", "rename"],
                },
                "list-intelligence": {
                    argv: ["attach", "--json", "list-intelligence"],
                },
                "suggest": {
                    argv: ["attach", "--json", "suggest"],
                },
            },
        };

        const directory = path.join(process.cwd(), ".analog-attach");
        fs.mkdirSync(directory, { recursive: true });

        const manifest_path = path.resolve(directory, "manifest.json");
        // eslint-disable-next-line unicorn/no-null
        fs.writeFileSync(manifest_path, JSON.stringify(manifest, null, 2));

        console.log(manifest_path);
    },
});

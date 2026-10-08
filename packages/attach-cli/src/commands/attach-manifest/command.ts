import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";
import type { LocalContext } from "../../context";

export function build_attach_manifest_command(_context: LocalContext): Command {
    return new Command("attach-manifest")
        .description("Write the attach-meta manifest and print its path to stdout")
        .action(async () => {
            const manifest = {
                protocol_version: "1.0.0",
                commands: {
                    "tool-config-get": {
                        description: "Read tool configuration. Pass one or more field names as positional args to read specific fields; omit all to read all. Check this first — most commands fail with an input-error if a field is missing.",
                        argv: ["attach-linux", "--json", "config-get"],
                    },
                    "tool-config-set": {
                        description: "Set a config field. Positional args: <field> <value>.",
                        argv: ["attach-linux", "--json", "config-set"],
                    },
                    "create-workfile": {
                        description: "Create a minimal DTSO overlay file in CWD and save its path as the overlay config field. --name <filename> overrides the default filename (overlay.dtso). Run this once before any overlay-editing command (add, update, delete, etc.).",
                        argv: ["attach-linux", "--json", "create-workfile"],
                        args: {
                            properties: {
                                name: { type: "string" },
                            },
                        },
                    },
                    "list": {
                        description: "List device bindings, properties, values, parents or slots. Subkinds: device [compatible], property <path> [property], value <path> <property>, parent <compatible>, slot [compatible]. Bare `list` shows available kinds.",
                        argv: ["attach-linux", "--json", "list"],
                    },
                    "add": {
                        description: "Add a device node to the overlay. The compatible string is required as the positional arg (e.g. `add adi,ad7124-8 --parent spi0`). --parent <path> sets the parent node (label-first or absolute). --name <name[@unit]> overrides the node name. --label <label> assigns a DTS label. Use `list device` to discover compatible strings and `list parent` to find the right bus. Child nodes (channels, ports) are created through `update <path> <child-name>` instead.",
                        argv: ["attach-linux", "--json", "add"],
                        args: {
                            properties: {
                                label: { type: "string" },
                            },
                        },
                        completions: [
                            {
                                arg: "add",
                                kind: "device-key"
                            },
                            {
                                arg: "parent",
                                kind: "parent"
                            }
                        ]
                    },
                    "read": {
                        description: "Read a node or property from the overlay. No path args returns the full overlay tree. Path args identify the target; accepted forms: bare label (imu1), absolute path (/soc/spi@7e204000), slash-separated label/child (imu1/channel@0), or multiple space-separated tokens resolved from root (soc spi@7e204000 → /soc/spi@7e204000). The last token may be a property name — the preceding tokens then identify the parent node.",
                        argv: ["attach-linux", "--json", "read"],
                    },
                    "update": {
                        description: "Set or insert a property (upsert) on an overlay node OR on a base-tree node. Setting a property on a base-tree node writes it into an overlay fragment targeting that node (a fragment is created if none exists yet); the base tree is never modified. The last slash-delimited segment of the path is the property name; everything before it identifies the node. Accepted forms: node label + property (imu1/reg), absolute path + property (/soc/spi@7e204000/reg), slash-separated label/child + property (imu1/channel@0/reg), or space-separated tokens where the last token is the property (soc spi@7e204000 reg). --with <value> is required. Value syntax: single number 0, single string foo, boolean flag true/false, array 'a b c' (space-separated items), matrix rows 'a b,c d' (comma separates rows, space separates items within a row). Comma is only a row separator; it can't appear in labels, macros, or numbers. Validation: when the property is defined by the node's binding it is type-checked against the schema; otherwise (binding not found, or property not in the binding) the value is written as-is with best-effort typing inferred from the value syntax.",
                        argv: ["attach-linux", "--json", "update"],
                    },
                    "delete": {
                        description: "Delete an overlay-added node (and its entire subtree) or a single property. Path identifies the target; accepted forms: node label (imu1), absolute path (/soc/spi@7e204000), slash-separated label/child (imu1/channel@0), space-separated tokens from root (soc spi@7e204000 → /soc/spi@7e204000). To delete a property use the slash-delimited forms where the last segment is the property name: imu1/reg, /soc/spi@7e204000/reg, imu1/channel@0/reg, or space-separated with last token as property (soc spi@7e204000 reg). Property deletion works both for properties on overlay-added nodes and for properties previously added onto a base-tree node in this overlay (the targeting fragment is pruned if it becomes empty). Without --force, a non-leaf node returns a preview (ok: true, severity: warn) with node_count and property_count — re-call with --force to confirm. Empty path without --force also previews; empty path with --force clears the entire overlay. Base-tree NODES cannot be deleted (returns in-base error); only overlay-added nodes and overlay properties can be removed.",
                        argv: ["attach-linux", "--json", "delete"],
                    },
                    "validate": {
                        description: "Validate the overlay against Linux dt-schema binding rules using dt-validate. Requires linux and overlay config fields. On first run generates .attach-linux/validation.json by running dt-mk-schema over the Linux bindings — this can take a minute; subsequent runs reuse the cached file. Empty errors array means validation passed; warnings may still be present.",
                        argv: ["attach-linux", "--json", "validate"],
                    },
                    "move": {
                        description: "Move an overlay-added node to a different parent: `move <path> <destination>`. Both arguments are label-first or absolute paths. Only overlay-added nodes can be moved — base-tree nodes return in-base.",
                        argv: ["attach-linux", "--json", "move"],
                    },
                    "rename": {
                        description: "Rename an overlay-added node or property. Positional args identify the target; accepted forms: node label (imu1), absolute path (/soc/spi@7e204000), slash-separated label/child (imu1/channel@0), or space-separated tokens from root (soc spi@7e204000) — the same forms work for properties, where the last segment is the property name. --to <new-name> (required): for nodes, bare name preserves the existing unit address (my_adc), name@unit overrides it (my_adc@1), name@ removes the unit address; for properties, pass the new property name. Only overlay-added nodes can be renamed — base-tree nodes return in-base. Detects sibling key conflicts.",
                        argv: ["attach-linux", "--json", "rename"],
                    },
                    "suggest": {
                        description: "Internal: return completion candidates for a suggestion kind (hidden __list command). First positional arg is the kind; remaining args depend on the kind.",
                        argv: ["attach-linux", "--json", "__list"],
                    },
                    "build": {
                        description: "Compile the overlay DTSO into a DTBO using dtc. Reads the overlay config field for the source path (--overlay overrides) and writes the compiled .dtbo next to it, saving that path to the overlay-compiled config field for deploy to pick up. The compile command comes from the build-command config field (default: dtc -@ -I dts -O dtb -o {output} {input}); {input}/{output} are substituted with the source and artifact paths. --build-command overrides the template for one run. Fails with an input-error if overlay is unset, the source is missing, or dtc is not installed; returns the artifact path on success.",
                        argv: ["attach-linux", "--json", "build"],
                    },
                    "deploy": {
                        description: "Copy the compiled DTBO to a remote device's /boot/overlays over sshpass+scp and reboot it. Reads overlay-compiled (the .dtbo path, written by build), deploy-ip, deploy-user, and deploy-password config fields; --dtbo, --ip, --user, --password override them. Fails with an input-error listing any unset field, if the .dtbo is missing, or if sshpass is not installed. Always reboots after a successful copy.",
                        argv: ["attach-linux", "--json", "deploy"],
                    },
                },
            };

            const directory = path.join(process.cwd(), ".attach-linux");
            fs.mkdirSync(directory, { recursive: true });

            const manifest_path = path.resolve(directory, "manifest.json");
            // eslint-disable-next-line unicorn/no-null
            fs.writeFileSync(manifest_path, JSON.stringify(manifest, null, 2));

            console.log(manifest_path);
        });
}

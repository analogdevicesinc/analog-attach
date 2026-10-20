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
                        description: "Create a minimal DTSO overlay file in CWD and save its path as the overlay config field. An optional positional <name> overrides the default filename; without it, uses overlay.dtso (or overlay-1.dtso, overlay-2.dtso, … when it already exists). Run this once before any overlay-editing command (add, update, delete, etc.).",
                        argv: ["attach-linux", "--json", "create-workfile"],
                    },
                    "list": {
                        description: "List device bindings, properties, values, parents or overlays. Subkinds: device [compatible], property <path> [property], value <path> <property>, parent <compatible>, overlay <compatible>. `list overlay` gives the overlays in the Linux tree (RPi *-overlay.dts, *.dtso) that add the device, as {name, path, fit, reason}: fit compares the overlay's root compatible with the base's (compatible, incompatible, unknown when it has none); compatible ones come first. Bare `list` shows available kinds.",
                        argv: ["attach-linux", "--json", "list"],
                    },
                    "add": {
                        description: "Add a device node to the overlay. The compatible string is required as the positional arg (e.g. `add adi,ad7124-8 --parent spi0`). --parent <path> sets the parent node (label-first or absolute). --name <name[@unit]> overrides the node name. --label <label> assigns a DTS label. --from-example copies the node from the binding's example for the parent's bus (name, reg, children and references as in the example; not with --name); the response's `unresolved` then lists the references that name nothing in the base or overlay ({path, property, reference}), to fix with update. Use `list device` to discover compatible strings and `list parent` to find the right bus. Child nodes (channels, ports) are created through `update <path> <child-name>` instead. The response's `missing_required` lists the required properties the node still lacks, in the order to set them (interrupt-parent before interrupts), each with its binding description and `suggestions` ready for update; ask the user for them in that order.",
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
                    "import": {
                        description: "Create a new workfile from an existing overlay and make it the configured overlay. Positional <overlay>: a file name from `list overlay` (or its stem without -overlay.dts / .dtso), or a path to an overlay file. Every fragment is imported as written; the RPi __overrides__ node is dropped, and targets and phandles are not remapped. When an overlay is already configured, the new workfile replaces it in the config and the old file is kept. The response gives `path` (the new workfile), `source`, `replaced` (the overlay configured before, if any), the board `fit` and `reason` as in `list overlay`, `unresolved_targets` ({fragment, property: target | target-path, target}) and `unresolved` ({path, property, reference}): the targets and references the base lacks, to fix with update; severity is warn when there is any, or when the overlay is for another board.",
                        argv: ["attach-linux", "--json", "import"],
                        completions: [
                            {
                                arg: "import",
                                kind: "overlay"
                            }
                        ]
                    },
                    "read": {
                        description: "Read a node or property from the overlay: `read [path] [property]`. No path returns the full overlay tree. <path> is label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000); the optional second positional names a property. When bindings are available a property response also carries `description` and `suggestions` (values ready for update; for a phandle, the nodes left out of the suggestions come last with `note` disabled or enabled by the overlay), and a node response carries `missing_required` (required properties not set yet, in the order to set them). --quiet leaves them out.",
                        argv: ["attach-linux", "--json", "read"],
                    },
                    "update": {
                        description: "Set or insert a property (upsert): `update <path> <property> [value...]`. <path> is one token: label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000); it may name an overlay node or a base-tree node, whose property goes into an overlay fragment targeting it (the base tree is never modified). Values are the positional tokens after the property: numbers (0, 0x1f) are cells, several tokens make an array, a `,` token separates matrix rows (`0 1 , 2 3` → <0 1>, <2 3>), macros (GPIO_ACTIVE_LOW, IRQ_TYPE_EDGE_FALLING) become their numbers, and labels of the base or overlay (gpio or &gpio) become phandles; words are strings where the binding expects strings, and an unknown word where cells are expected is rejected. The binding only shapes the value, it never rejects it. With no value: a flag property is set, a property with a value is read (the `read` response), and an unknown absent name becomes a flag. Setting interrupts without an interrupt-parent also writes the inherited one; setting reg renames the node's unit address. A child-node name the binding allows (channel@0) with no value creates that child (reg from the unit address, decimal when the binding names the children so); the response then carries `path` and `missing_required` (required properties the child still lacks, with description and suggestions): ask the user for each and set them with update <path>/<child> <property> <value>. An existing child is read instead.",
                        argv: ["attach-linux", "--json", "update"],
                    },
                    "delete": {
                        description: "Delete an overlay node (and its subtree) or one property: `delete <path> [property]`. <path> is label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000). A property can be removed from an overlay node or from a base-tree node's overlay fragment (the fragment is pruned when it becomes empty). Without --force, a node with children returns a preview (ok: true, severity: warn) with node_count and property_count; re-call with --force to delete. No path previews the whole overlay; no path with --force clears it. Base-tree nodes cannot be deleted (in-base error): disable them instead.",
                        argv: ["attach-linux", "--json", "delete"],
                    },
                    "enable": {
                        description: "Set status = \"okay\" on a node: `enable <path>`, with <path> label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000). On a base-tree node the status goes into an overlay fragment targeting it.",
                        argv: ["attach-linux", "--json", "enable"],
                    },
                    "disable": {
                        description: "Set status = \"disabled\" on a node: `disable <path>`, with <path> label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000). Use it on base-tree nodes that clash with a new device (a spidev on the same chip select).",
                        argv: ["attach-linux", "--json", "disable"],
                    },
                    "validate": {
                        description: "Validate the overlay against Linux dt-schema binding rules using dt-validate. Requires linux and overlay config fields. On first run generates .attach-linux/validation.json by running dt-mk-schema over the Linux bindings — this can take a minute; subsequent runs reuse the cached file. Empty errors array means validation passed; warnings may still be present, including reg clashes between enabled siblings (a taken chip select or address).",
                        argv: ["attach-linux", "--json", "validate"],
                    },
                    "move": {
                        description: "Move an overlay-added node to a different parent: `move <path> <destination>`. Both arguments are label-first or absolute paths. Only overlay-added nodes can be moved — base-tree nodes return in-base.",
                        argv: ["attach-linux", "--json", "move"],
                    },
                    "rename": {
                        description: "Rename an overlay node: `rename <path> <new-name>`. <path> is label (imu1), label-first (spi0/adi,ad7124-8@0, imu1/channel@0) or absolute (/soc/spi@7e204000). A bare name keeps the unit address (adc@0 → my_adc@0); name@unit changes it and updates reg to match (and warns when the new reg clashes with a sibling). Base-tree nodes return in-base; a name already used under the same parent is refused.",
                        argv: ["attach-linux", "--json", "rename"],
                    },
                    "suggest": {
                        description: "Internal: return completion candidates for a suggestion kind (hidden __list command). First positional arg is the kind; remaining args depend on the kind.",
                        argv: ["attach-linux", "--json", "__list"],
                    },
                    "build": {
                        description: "Compile the overlay DTSO into a DTBO using the bundled dtc. Reads the overlay config field for the source path and writes the compiled .dtbo next to it (overlay.dtso -> overlay.dtbo), where deploy picks it up. Fails with an input-error if overlay is unset or the source is missing; returns the artifact path on success.",
                        argv: ["attach-linux", "--json", "build"],
                    },
                    "deploy": {
                        description: "Copy the compiled DTBO to a remote device's /boot/overlays over sshpass+scp and reboot it. Deploys the .dtbo that build wrote next to the overlay and reads the deploy-ip, deploy-user, and deploy-password config fields. Fails with an input-error listing any unset field, if the .dtbo is missing, or if sshpass is not installed. Always reboots after a successful copy.",
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

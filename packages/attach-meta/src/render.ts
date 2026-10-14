import type { CommandName } from "./protocol/manifest";

export function renderResponse(cmd: CommandName, response: Record<string, unknown>, jsonMode: boolean): void {
    if (jsonMode) {
        // eslint-disable-next-line unicorn/no-null
        console.log(JSON.stringify(response, null, 2));
        return;
    }

    switch (cmd) {
        case "add": { renderAdd(response); break;
        }
        case "read": { renderRead(response); break;
        }
        case "delete": { renderDelete(response); break;
        }
        case "validate": { renderValidate(response); break;
        }
        case "list-devices": { renderListDevices(response); break;
        }
        case "create-workfile": { renderCreateWorkfile(response); break;
        }
        case "tool-config-get": { renderToolConfig(response); break;
        }
        case "list-intelligence": { renderListIntelligence(response); break;
        }
        case "suggest": { renderSuggest(response); break;
        }
        default: { renderCommon(response); break;
        }
    }
}

function renderCommon(v: Record<string, unknown>): void {
    const severity = v["severity"] as string;
    const icon = severity === "info" ? "✓" : (severity === "warn" ? "⚠" : "✗");
    process.stderr.write(`${icon} ${v["message"]}\n`);
}

function renderAdd(v: Record<string, unknown>): void {
    const pathArray = (v["path"] as string[] | undefined) ?? [];
    const pathString = pathArray.join(" → ");
    process.stderr.write(`${v["message"]} (key: ${v["key"]}, path: ${pathString})\n`);
}

function renderRead(v: Record<string, unknown>): void {
    if (v["kind"] === "node") {
        renderNode(v as unknown as NodeLike, 0);
    } else if (v["kind"] === "property") {
        process.stderr.write(`  ${v["key"]} = ${v["value"]}\n`);
    } else {
        // eslint-disable-next-line unicorn/no-null
        console.log(JSON.stringify(v, null, 2));
    }
}

interface NodeLike {
    key: string;
    alias?: string[];
    properties: Array<{ key: string; value: unknown }>;
    children: NodeLike[];
}

function renderNode(node: NodeLike, indent: number): void {
    const pad = "  ".repeat(indent);
    process.stderr.write(`${pad}${node.key}\n`);
    if (node.alias && node.alias.length > 0) {
        process.stderr.write(`${pad}  aliases: ${node.alias.join(", ")}\n`);
    }
    for (const property of node.properties) {
        process.stderr.write(`${pad}  ${property.key} = ${property.value}\n`);
    }
    for (const child of node.children) {
        renderNode(child, indent + 1);
    }
}

function renderDelete(v: Record<string, unknown>): void {
    if ("node_count" in v) {
        process.stderr.write(`Delete preview: ${v["node_count"]} nodes, ${v["property_count"]} properties\n`);
        for (const p of (v["paths"] as string[][] | undefined) ?? []) {
            process.stderr.write(`  ${p.join(" → ")}\n`);
        }
        process.stderr.write("Use --force to execute.\n");
        return;
    }
    renderCommon(v);
}

function renderValidate(v: Record<string, unknown>): void {
    const errors = (v["errors"] as Array<{ path: string[]; message: string }> | undefined) ?? [];
    const warnings = (v["warnings"] as Array<{ path: string[]; message: string }> | undefined) ?? [];
    if (errors.length === 0 && warnings.length === 0) {
        process.stderr.write("✓ No issues found.\n");
        return;
    }
    for (const error_ of errors) {
        const pathString = error_.path.length === 0 ? "(file-level)" : error_.path.join(" → ");
        process.stderr.write(`✗ error [${pathString}]: ${error_.message}\n`);
    }
    for (const w of warnings) {
        const pathString = w.path.length === 0 ? "(file-level)" : w.path.join(" → ");
        process.stderr.write(`⚠ warning [${pathString}]: ${w.message}\n`);
    }
}

function renderListDevices(v: Record<string, unknown>): void {
    const devices = (v["devices"] as Array<{ key: string; tag: string }> | undefined) ?? [];
    if (devices.length === 0) {
        process.stderr.write("No devices found.\n");
        return;
    }
    for (const d of devices) {
        process.stderr.write(`  ${d.key} (${d.tag})\n`);
    }
}

function renderCreateWorkfile(v: Record<string, unknown>): void {
    process.stderr.write(`${v["message"]} → ${v["path"]}\n`);
}

function renderToolConfig(v: Record<string, unknown>): void {
    const configs = (v["configs"] as Array<{ field_name: string; required: boolean; description: string; default: unknown }> | undefined) ?? [];
    for (const cfg of configs) {
        const required = cfg.required ? " (required)" : "";
        const defaultString = cfg.default === undefined || cfg.default === null ? "none" : String(cfg.default);
        process.stderr.write(`  ${cfg.field_name}${required}: ${cfg.description} [default: ${defaultString}]\n`);
    }
}

function renderListIntelligence(v: Record<string, unknown>): void {
    const intelligence = (v["intelligence"] as Array<{ kind: string; description: string; args: Array<{ name: string }> }> | undefined) ?? [];
    if (intelligence.length === 0) {
        process.stderr.write("No intelligence kinds available.\n");
        return;
    }
    for (const index of intelligence) {
        const argumentNames = index.args.map(a => a.name);
        process.stderr.write(`  ${index.kind} — ${index.description}\n`);
        if (argumentNames.length > 0) {
            process.stderr.write(`    args: ${argumentNames.join(", ")}\n`);
        }
    }
}

function renderSuggest(v: Record<string, unknown>): void {
    const suggestions = (v["suggestions"] as Array<{ value: string; display_string?: string }> | undefined) ?? [];
    for (const s of suggestions) {
        if (s.display_string) {
            process.stderr.write(`  ${s.value} — ${s.display_string}\n`);
        } else {
            process.stderr.write(`  ${s.value}\n`);
        }
    }
}

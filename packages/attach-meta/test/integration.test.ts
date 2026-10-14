import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, "../dist/cli.js");

class TestEnvironment {
    readonly dir: string;
    readonly toolPath: string;
    readonly configPath: string;
    readonly manifestPath: string;
    readonly logPath: string;

    constructor() {
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "attach-meta-test-"));
        this.toolPath = path.join(this.dir, "fake-tool");
        this.configPath = path.join(this.dir, ".analog-attach.toml");
        this.manifestPath = path.join(this.dir, "manifest.json");
        this.logPath = path.join(this.dir, "invocations.log");
    }

    cleanup(): void {
        fs.rmSync(this.dir, { recursive: true, force: true });
    }

    writeDefaultManifest(): void {
        const manifest = {
            protocol_version: "1.0.0",
            commands: {
                "tool-config-get": { argv: [this.toolPath, "config-get"] },
                "tool-config-set": { argv: [this.toolPath, "config-set"] },
                "create-workfile": { argv: [this.toolPath, "workfile"] },
                "list-devices": { argv: [this.toolPath, "devices"] },
                "add": {
                    argv: [this.toolPath, "add"],
                    args: { properties: { bus_id: { type: "string" } } },
                    completions: [{ arg: "add", kind: "device-key" }],
                },
                "read": { argv: [this.toolPath, "read"] },
                "update": { argv: [this.toolPath, "update"] },
                "delete": { argv: [this.toolPath, "delete"] },
                "validate": { argv: [this.toolPath, "validate"] },
                "generate": { argv: [this.toolPath, "generate"] },
                "build": { argv: [this.toolPath, "build"] },
                "deploy": { argv: [this.toolPath, "deploy"] },
                "list-intelligence": { argv: [this.toolPath, "list-intelligence"] },
                "suggest": { argv: [this.toolPath, "suggest"] },
            },
        };
        // eslint-disable-next-line unicorn/no-null
        fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
    }

    writeManifest(manifest: Record<string, unknown>): void {
        // eslint-disable-next-line unicorn/no-null
        fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
    }

    writeTool(extraCases = ""): void {
        const script = `#!/bin/sh
LOG="${this.logPath}"
echo "$0 $*" >> "$LOG"

case "$1" in
    attach-manifest)
        echo "${this.manifestPath}"
        exit 0
        ;;${extraCases}
    config-get)
        cat <<'JSON'
{"ok":true,"message":"configs","severity":"info","configs":[
  {"field_name":"workfile","description":"Path to workfile","type":"path","required":true,"default":null,"value":null},
  {"field_name":"board","description":"Target board","type":"string","required":false,"default":"generic","value":"generic"}
]}
JSON
        exit 0
        ;;
    config-set)
        echo '{"ok":true,"message":"config set","severity":"info"}'
        exit 0
        ;;
    workfile)
        echo '{"ok":true,"message":"workfile created","severity":"info","path":"/tmp/test.dts"}'
        exit 0
        ;;
    devices)
        echo '{"ok":true,"message":"devices","severity":"info","devices":[{"tag":"sensor","key":"ad7124"},{"tag":"sensor","key":"ad5940"}]}'
        exit 0
        ;;
    add)
        shift
        echo '{"ok":true,"message":"added","severity":"info","key":"new_node","path":["root","new_node"]}'
        exit 0
        ;;
    read)
        shift
        echo '{"ok":true,"kind":"node","key":"root","properties":[],"children":[{"kind":"node","key":"child","properties":[{"kind":"property","key":"p","type":{"kind":"string"},"value":"v"}],"children":[]}]}'
        exit 0
        ;;
    update)
        shift
        echo '{"ok":true,"message":"updated","severity":"info"}'
        exit 0
        ;;
    delete)
        shift
        if echo "$*" | grep -q "\\-\\-force"; then
            echo '{"ok":true,"message":"deleted","severity":"info"}'
        else
            echo '{"ok":true,"message":"preview","severity":"info","node_count":2,"property_count":3,"paths":[["a","b"],["a","c"]]}'
        fi
        exit 0
        ;;
    validate)
        echo '{"errors":[{"kind":"generic","path":["soc","spi"],"message":"bad"},{"kind":"generic","path":["uart"],"message":"also bad"},{"kind":"generic","path":[],"message":"file-level"}],"warnings":[{"kind":"generic","path":["soc","i2c"],"message":"warn"}]}'
        exit 0
        ;;
    generate|build|deploy)
        echo '{"ok":true,"message":"done","severity":"info"}'
        exit 0
        ;;
    list-intelligence)
        echo '{"ok":true,"message":"intelligence","severity":"info","intelligence":[{"kind":"device-key","description":"Available device keys","args":[]}]}'
        exit 0
        ;;
    suggest)
        shift
        echo '{"ok":true,"message":"suggestions","severity":"info","suggestions":[{"value":"ad7124"},{"value":"ad5940"}]}'
        exit 0
        ;;
    *)
        echo '{"ok":false,"message":"unknown command: '"$1"'","severity":"error"}'
        exit 0
        ;;
esac
`;
        fs.writeFileSync(this.toolPath, script, { mode: 0o755 });
    }

    writeConfig(): void {
        const content = fs.readFileSync(this.manifestPath, "utf8");
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        const config = `[meta]
default_tool = "fake-tool"

[[tools]]
name = "fake-tool"
binary = "${this.toolPath}"
manifest_path = "${this.manifestPath}"
manifest_sha256 = "${hash}"

[tools.settings]
`;
        fs.writeFileSync(this.configPath, config);
    }

    runCmd(...arguments_: string[]): { stdout: string; stderr: string; status: number } {
        try {
            const stdout = execFileSync("node", [CLI_PATH, ...arguments_], {
                cwd: this.dir,
                encoding: "utf8",
                timeout: 15_000,
                env: { ...process.env, PATH: `${this.dir}:${process.env["PATH"]}` },
            });
            return { stdout, stderr: "", status: 0 };
        } catch (error: any) {
            return {
                stdout: (error.stdout as string) ?? "",
                stderr: (error.stderr as string) ?? "",
                status: (error.status as number) ?? 1,
            };
        }
    }

     
    runJson(...arguments_: string[]): { stdout: string; stderr: string; status: number; json?: any } {
        const result = this.runCmd("--json", ...arguments_) as { stdout: string; stderr: string; status: number; json?: any };
        try {
            result.json = JSON.parse(result.stdout);
        } catch { /* not JSON */ }
        return result;
    }

    invocationLog(): string {
        try {
            return fs.readFileSync(this.logPath, "utf8");
        } catch {
            return "";
        }
    }
}

describe("integration", () => {
    let environment: TestEnvironment;

    beforeEach(() => {
        environment = new TestEnvironment();
    });

    afterEach(() => {
        environment.cleanup();
    });

    // ── Init ──

    describe("init", () => {
        it("writes toml and returns success", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            const result = environment.runJson("init", environment.toolPath, "--no-interactive");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
            expect(result.json?.config_complete).toBeDefined();
            expect(fs.existsSync(environment.configPath)).toBe(true);
        });

        it("returns missing_fields for unconfigured required fields", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            const result = environment.runJson("init", environment.toolPath, "--no-interactive");
            expect(result.status).toBe(0);
            const missing = result.json?.missing_fields as string[];
            expect(missing).toContain("workfile");
        });

        it("rejects major version mismatch", () => {
            environment.writeManifest({
                protocol_version: "99.0.0",
                commands: {
                    "add": { argv: [environment.toolPath, "add"] },
                    "read": { argv: [environment.toolPath, "read"] },
                    "update": { argv: [environment.toolPath, "update"] },
                    "delete": { argv: [environment.toolPath, "delete"] },
                    "validate": { argv: [environment.toolPath, "validate"] },
                    "tool-config-get": { argv: [environment.toolPath, "config-get"] },
                    "tool-config-set": { argv: [environment.toolPath, "config-set"] },
                    "create-workfile": { argv: [environment.toolPath, "workfile"] },
                    "list-devices": { argv: [environment.toolPath, "devices"] },
                },
            });
            environment.writeTool();
            const result = environment.runCmd("init", environment.toolPath, "--no-interactive");
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("version mismatch");
        });

        it("rejects missing required command", () => {
            environment.writeManifest({
                protocol_version: "1.0.0",
                commands: {
                    "add": { argv: [environment.toolPath, "add"] },
                },
            });
            environment.writeTool();
            const result = environment.runCmd("init", environment.toolPath, "--no-interactive");
            expect(result.status).not.toBe(0);
        });

        it("rejects required in tool args", () => {
            environment.writeDefaultManifest();
            const manifest = JSON.parse(fs.readFileSync(environment.manifestPath, "utf8"));
            manifest.commands.add.args = {
                properties: { bus_id: { type: "string" } },
                required: ["bus_id"],
            };
            fs.writeFileSync(environment.manifestPath, JSON.stringify(manifest));
            environment.writeTool();
            const result = environment.runCmd("init", environment.toolPath, "--no-interactive");
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("required");
        });
    });

    // ── Input validation ──

    describe("input validation", () => {
        it("add without key or name is rejected", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("add");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("input");
        });

        it("add with key succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("add", "my_device");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
            expect(result.json?.key).toBe("new_node");
        });

        it("add with --name succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("add", "--name", "my_device");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });

        it("add with tool-declared flag", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("add", "k", "--bus_id", "b1");
            expect(result.status).toBe(0);
        });
    });

    // ── CRUD ──

    describe("crud", () => {
        it("read returns node", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(0);
            expect(result.json?.kind).toBe("node");
        });

        it("read with property path", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("read", "root");
            expect(result.status).toBe(0);
        });

        it("update requires --with", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("update", "some/path");
            expect(result.status).toBe(2);
        });

        it("update with --with succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("update", "some/path", "--with", "val");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });

        it("delete without --force shows preview", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("delete", "a");
            expect(result.status).toBe(0);
            expect(result.json?.node_count).toBeDefined();
        });

        it("delete with --force", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("delete", "a", "--force");
            expect(result.status).toBe(0);
            expect(result.json?.message).toBe("deleted");
        });

        it("delete with no args", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("delete");
            expect(result.status).toBe(0);
        });
    });

    // ── Validate ──

    describe("validate", () => {
        it("no path returns all errors", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("validate");
            expect(result.status).toBe(0);
            const errors = result.json?.errors as any[];
            expect(errors.length).toBe(3);
        });

        it("path filters by prefix", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("validate", "soc");
            expect(result.status).toBe(0);
            const errors = result.json?.errors as any[];
            expect(errors.length).toBe(2);
            const warnings = result.json?.warnings as any[];
            expect(warnings.length).toBe(1);
        });

        it("file-level errors always pass through", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("validate", "nonexistent");
            expect(result.status).toBe(0);
            const errors = result.json?.errors as any[];
            expect(errors.length).toBe(1);
            expect(errors[0].path).toEqual([]);
        });
    });

    // ── Transport errors ──

    describe("transport errors", () => {
        it("non-zero exit", () => {
            environment.writeDefaultManifest();
            fs.writeFileSync(environment.toolPath, `#!/bin/sh
case "$1" in
    attach-manifest) echo "${environment.manifestPath}"; exit 0 ;;
    *) exit 42 ;;
esac
`, { mode: 0o755 });
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("transport");
        });

        it("empty stdout", () => {
            environment.writeDefaultManifest();
            fs.writeFileSync(environment.toolPath, `#!/bin/sh
case "$1" in
    attach-manifest) echo "${environment.manifestPath}"; exit 0 ;;
    *) exit 0 ;;
esac
`, { mode: 0o755 });
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("transport");
        });

        it("malformed JSON", () => {
            environment.writeDefaultManifest();
            fs.writeFileSync(environment.toolPath, `#!/bin/sh
case "$1" in
    attach-manifest) echo "${environment.manifestPath}"; exit 0 ;;
    *) echo "not json"; exit 0 ;;
esac
`, { mode: 0o755 });
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("transport");
        });

        it("timeout", () => {
            environment.writeManifest({
                protocol_version: "1.0.0",
                commands: {
                    "tool-config-get": { argv: [environment.toolPath, "config-get"] },
                    "tool-config-set": { argv: [environment.toolPath, "config-set"] },
                    "create-workfile": { argv: [environment.toolPath, "workfile"] },
                    "list-devices": { argv: [environment.toolPath, "devices"] },
                    "add": { argv: [environment.toolPath, "add"] },
                    "read": { argv: [environment.toolPath, "read"], timeout_ms: 100 },
                    "update": { argv: [environment.toolPath, "update"] },
                    "delete": { argv: [environment.toolPath, "delete"] },
                    "validate": { argv: [environment.toolPath, "validate"] },
                },
            });
            fs.writeFileSync(environment.toolPath, `#!/bin/sh
case "$1" in
    attach-manifest) echo "${environment.manifestPath}"; exit 0 ;;
    *) sleep 10; exit 0 ;;
esac
`, { mode: 0o755 });
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("transport");
        });
    });

    // ── Protocol error ──

    describe("protocol error", () => {
        it("ok:false exits 1", () => {
            environment.writeDefaultManifest();
            fs.writeFileSync(environment.toolPath, `#!/bin/sh
case "$1" in
    attach-manifest) echo "${environment.manifestPath}"; exit 0 ;;
    *) echo '{"ok":false,"message":"nope","severity":"error"}'; exit 0 ;;
esac
`, { mode: 0o755 });
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(1);
            expect(result.json?.["ok"]).toBe(false);
        });
    });

    // ── Pipeline ──

    describe("pipeline", () => {
        it("generate succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("generate");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });

        it("build succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("build");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });

        it("deploy succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("deploy");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });
    });

    // ── Exit codes ──

    describe("exit codes", () => {
        it("0 for ok:true", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runCmd("read");
            expect(result.status).toBe(0);
        });

        it("2 for input error", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runCmd("add");
            expect(result.status).toBe(2);
        });

        it("2 for unknown command", () => {
            const result = environment.runCmd("nonexistent");
            expect(result.status).toBe(2);
        });
    });

    // ── Completions ──

    describe("completions", () => {
        it("completion bash returns a script", () => {
            const result = environment.runCmd("completion", "bash");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("_analog_attach_completions");
        });

        it("completion zsh returns a script", () => {
            const result = environment.runCmd("completion", "zsh");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("compdef");
        });

        it("completion fish returns a script", () => {
            const result = environment.runCmd("completion", "fish");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("__analog_attach_completions");
        });

        it("__complete lists commands when tool configured", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runCmd("__complete", "--");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("add");
            expect(result.stdout).toContain("read");
            expect(result.stdout).toContain("init");
        });

        it("__complete filters subcommand names", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runCmd("__complete", "--", "re");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("read");
            expect(result.stdout).not.toContain("add\n");
        });

        it("__complete shows flags for a command", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runCmd("__complete", "--", "delete", "");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("--force");
        });
    });

    // ── --json mode ──

    describe("--json mode", () => {
        it("outputs JSON envelope on error", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("add");
            expect(result.json).toBeDefined();
            expect(result.json?.["ok"]).toBe(false);
            expect(result.json?.category).toBe("input");
        });

        it("outputs raw JSON on success", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("read");
            expect(result.status).toBe(0);
            expect(result.json?.kind).toBe("node");
        });
    });

    // ── Schema subcommand ──

    describe("schema subcommand", () => {
        it("responses prints valid JSON", () => {
            const result = environment.runCmd("schema", "responses");
            expect(result.status).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.$schema).toBeDefined();
        });

        it("manifest prints valid JSON", () => {
            const result = environment.runCmd("schema", "manifest");
            expect(result.status).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.$id).toBe("analog-attach/manifest");
        });

        it("unknown schema exits 2", () => {
            const result = environment.runCmd("schema", "bogus");
            expect(result.status).toBe(2);
        });
    });

    // ── Move/Rename not in manifest ──

    describe("restructure", () => {
        it("move not in manifest returns error", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("move", "a", "--to", "b");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("manifest");
        });

        it("rename not in manifest returns error", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("rename", "a", "--to", "b");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("manifest");
        });
    });

    // ── Workspace ──

    describe("workspace", () => {
        it("create-workfile succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("create-workfile");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
            expect(result.json?.path).toBe("/tmp/test.dts");
        });

        it("list-devices returns devices", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("list-devices");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
            const devices = result.json?.devices as any[];
            expect(devices.length).toBe(2);
            expect(devices[0].key).toBe("ad7124");
        });
    });

    // ── Meta intelligence ──

    describe("intelligence", () => {
        it("list-intelligence works without a tool", () => {
            const result = environment.runJson("list-intelligence");
            expect(result.status).toBe(0);
            const intelligence = result.json?.intelligence as any[];
            expect(intelligence.some((index: any) => index.kind === "attachable")).toBe(true);
        });

        it("suggest attachable returns suggestions array", () => {
            const result = environment.runJson("suggest", "attachable");
            expect(result.status).toBe(0);
            expect(result.json?.suggestions).toBeDefined();
            expect(Array.isArray(result.json?.suggestions)).toBe(true);
        });

        it("list-intelligence merges meta and tool", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("list-intelligence");
            expect(result.status).toBe(0);
            const intelligence = result.json?.intelligence as any[];
            expect(intelligence.some((index: any) => index.kind === "attachable")).toBe(true);
            expect(intelligence.some((index: any) => index.kind === "device-key")).toBe(true);
        });
    });

    // ── Hash caching ──

    describe("hash caching", () => {
        it("unchanged manifest skips revalidation", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result1 = environment.runJson("read");
            expect(result1.status).toBe(0);
            const result2 = environment.runJson("read");
            expect(result2.status).toBe(0);
        });

        it("changed manifest triggers revalidation", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result1 = environment.runJson("read");
            expect(result1.status).toBe(0);

            const manifest = JSON.parse(fs.readFileSync(environment.manifestPath, "utf8"));
            manifest.commands.add.description = "added a description";
            // eslint-disable-next-line unicorn/no-null
            fs.writeFileSync(environment.manifestPath, JSON.stringify(manifest, null, 2));

            const result2 = environment.runJson("read");
            expect(result2.status).toBe(0);
        });

        it("missing manifest file is a hard error", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            fs.unlinkSync(environment.manifestPath);
            const result = environment.runJson("read");
            expect(result.status).toBe(2);
            expect(result.json?.category).toBe("manifest");
        });
    });

    // ── Config ──

    describe("tool-config", () => {
        it("tool-config-get returns configs", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("tool-config-get");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
            const configs = result.json?.configs as any[];
            expect(configs.length).toBe(2);
        });

        it("tool-config-set succeeds", () => {
            environment.writeDefaultManifest();
            environment.writeTool();
            environment.writeConfig();
            const result = environment.runJson("tool-config-set", "workfile", "/tmp/test.dts");
            expect(result.status).toBe(0);
            expect(result.json?.["ok"]).toBe(true);
        });
    });
});

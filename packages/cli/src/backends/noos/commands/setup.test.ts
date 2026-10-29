import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looks_like_capi } from "../settings";
import { find_capi_candidates, module_roots_near } from "./setup";

// The guided setup's discovery: where capi is, and which module repositories sit next to
// it. Each test lays out a small tree of module.yml files in a temporary directory.
describe("guided setup discovery", () => {
    let root: string;

    function module_at(relative: string, name: string, type: string): string {
        const directory = path.join(root, relative);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "module.yml"), `name: ${name}\ntype: ${type}\n`);
        return directory;
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "aa-setup-"));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("knows capi by the name in its module.yml", () => {
        const capi = module_at("work/capi", "capi", "interface");
        const other = module_at("work/capi-noos", "capi-noos", "driver_collection");
        expect(looks_like_capi(capi)).toBe(true);
        expect(looks_like_capi(other)).toBe(false);
        expect(looks_like_capi(path.join(root, "missing"))).toBe(false);
    });

    it("finds capi from the home directory, two levels in", () => {
        const capi = module_at("home/work/capi", "capi", "interface");
        const elsewhere = path.join(root, "elsewhere");
        fs.mkdirSync(elsewhere);
        expect(find_capi_candidates(elsewhere, path.join(root, "home"))).toEqual([capi]);
    });

    it("follows a symlinked folder to the capi inside it", () => {
        module_at("data/work/capi", "capi", "interface");
        fs.mkdirSync(path.join(root, "home"));
        fs.symlinkSync(path.join(root, "data/work"), path.join(root, "home/work"));
        expect(find_capi_candidates(path.join(root, "home"), path.join(root, "home")))
            .toContain(path.join(root, "home/work/capi"));
    });

    it("finds capi above the current directory, nearest first", () => {
        const capi = module_at("work/capi", "capi", "interface");
        const project = path.join(root, "work/projects/demo");
        fs.mkdirSync(project, { recursive: true });
        expect(find_capi_candidates(project, path.join(root, "nohome"))[0]).toBe(capi);
    });

    it("lists the module repositories beside capi, and only those rulesets come from", () => {
        const capi = module_at("work/capi", "capi", "interface");
        const maxim = module_at("work/capi-maxim", "capi-maxim", "platform");
        const noos = module_at("work/capi-noos", "capi-noos", "driver_collection");
        const utility = module_at("work/capi-util", "capi-util", "utility");
        module_at("work/capi-hello", "capi-hello", "application");
        fs.mkdirSync(path.join(root, "work/notes"));

        expect(module_roots_near(capi)).toEqual([
            { path: maxim, name: "capi-maxim", type: "platform" },
            { path: noos, name: "capi-noos", type: "driver_collection" },
            { path: utility, name: "capi-util", type: "utility" },
        ]);
    });
});

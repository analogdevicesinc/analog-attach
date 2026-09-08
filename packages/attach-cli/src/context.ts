import type { CommandContext } from "@stricli/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LocalContext extends CommandContext {
    readonly process: NodeJS.Process;
    readonly json: boolean;
}

export function buildContext(process: NodeJS.Process, json: boolean): LocalContext {
    return {
        process,
        os,
        fs,
        path,
        json,
    };
}

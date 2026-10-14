import * as fs from "node:fs";

export interface Prompter {
    promptLine(prompt: string): string | undefined;
    confirm(prompt: string, defaultValue: boolean): boolean;
}

export class StdinPrompter implements Prompter {
    promptLine(prompt: string): string | undefined {
        process.stderr.write(prompt);
        const buf = Buffer.alloc(1);
        let line = "";
        try {
            const fd = process.stdin.fd;
            while (true) {
                // eslint-disable-next-line unicorn/no-null
                const bytesRead = fs.readSync(fd, buf, 0, 1, null);
                if (bytesRead === 0) {return undefined;}
                const ch = buf.toString("utf8", 0, bytesRead);
                if (ch === "\n") {break;}
                line += ch;
            }
            const trimmed = line.trimEnd();
            return trimmed === "" ? undefined : trimmed;
        } catch {
            return undefined;
        }
    }

    confirm(prompt: string, defaultValue: boolean): boolean {
        const suffix = defaultValue ? "[Y/n]" : "[y/N]";
        const answer = this.promptLine(`${prompt} ${suffix} `);
        if (answer === undefined) {return defaultValue;}
        return ["y", "yes"].includes(answer.toLowerCase());
    }
}

export class ScriptedPrompter implements Prompter {
    private responses: string[];
    constructor(responses: string[]) {
        this.responses = [...responses];
    }

    promptLine(_prompt: string): string | undefined {
        if (this.responses.length === 0) {return undefined;}
        return this.responses.shift();
    }

    confirm(_prompt: string, defaultValue: boolean): boolean {
        const answer = this.promptLine("");
        if (answer === undefined) {return defaultValue;}
        return ["y", "yes"].includes(answer.toLowerCase());
    }
}

export function isInteractive(): boolean {
    return process.stdin.isTTY === true;
}

export function formatConfigPrompt(cfg: { field_name: string; required: boolean; description: string; default: unknown }): string {
    const required = cfg.required ? " (required)" : "";
    const defaultString = cfg.default === undefined || cfg.default === null ? "" : ` [default: ${String(cfg.default)}]`;
    return `  ${cfg.field_name}${required}: ${cfg.description}${defaultString}`;
}

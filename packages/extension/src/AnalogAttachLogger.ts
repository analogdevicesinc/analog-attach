import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import path from "node:path";
import { bigIntReplacer } from "./utilities";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG" | "EVENT";

interface Metadata {
    extensionId: string;
    extensionVersion: string;
    vscodeVersion: string;
    platform: NodeJS.Platform;
    createdAt: string;
}

/**
 * Logs to console and the VS Code log location for this extension.
 * Uses `ExtensionContext.logUri`, which VS Code maps to the per-user
 * log folder on Linux, macOS, and Windows.
 */
export class AnalogAttachLogger {
    private static instance: AnalogAttachLogger | undefined;

    private readonly logFilePath: string | undefined;
    private readonly ready: Promise<void>;
    private readonly context?: vscode.ExtensionContext;
    private suppressMessages: boolean; // For tests

    /**
     * Singleton accessor. The first call must provide the extension context.
     */
    public static getInstance(context?: vscode.ExtensionContext): AnalogAttachLogger {
        if (AnalogAttachLogger.instance === undefined) {
            AnalogAttachLogger.instance = new AnalogAttachLogger(context);
        }
        return AnalogAttachLogger.instance;
    }

    private constructor(_context?: vscode.ExtensionContext) {
        this.context = _context;
        const logDirectory = this.context?.logUri.fsPath;
        this.logFilePath = logDirectory ? path.join(logDirectory, "analog-attach.log") : undefined;
        this.ready = this.initialize(logDirectory);
        this.suppressMessages = false;
    }

    private _suppressMessages(isSuppressed: boolean) {
        this.suppressMessages = isSuppressed;
    }

    /**
     * Should be used in tests so we don't pollute the logs if not necessary
     * @param isSuppressed boolean
     */
    public static suppressMessages(isSuppressed: boolean) {
        AnalogAttachLogger.getInstance()._suppressMessages(isSuppressed);
    }

    private async log(level: LogLevel, message: string, data?: unknown): Promise<void> {
        if (this.suppressMessages) {
            return;
        }
        await this.ready;
        const line = this.formatLine(level, message, data);
        this.writeToConsole(level, line);
        if (this.logFilePath) {
            await fs.appendFile(this.logFilePath, `${line}\n`);
        }
    }

    public static info(message: string, data?: unknown): Promise<void> {
        return AnalogAttachLogger.getInstance().log("INFO", message, data);
    }

    public static warn(message: string, data?: unknown): Promise<void> {
        return AnalogAttachLogger.getInstance().log("WARN", message, data);
    }

    public static error(message: string, data?: unknown): Promise<void> {
        return AnalogAttachLogger.getInstance().log("ERROR", message, data);
    }

    public static debug(message: string, data?: unknown): Promise<void> {
        return AnalogAttachLogger.getInstance().log("DEBUG", message, data);
    }

    /**
     * High-level user action logging for debugging/telemetry-less traces.
     * Examples: "opened device", "compiled tree", "deployed overlay".
     */
    public static userAction(action: string, details?: Record<string, unknown>): Promise<void> {
        return AnalogAttachLogger.getInstance().log("EVENT", action, details);
    }

    /**
     * Path helpers for tests/inspection.
     */
    public static getLogFilePath(): string | undefined {
        const instance = AnalogAttachLogger.getInstance();
        return instance.logFilePath;
    }

    private async initialize(logDirectory?: string): Promise<void> {
        if (this.logFilePath === undefined || logDirectory === undefined) {
            return; // console-only fallback
        }
        await fs.mkdir(logDirectory, { recursive: true });
        await this.writeMetadataHeader();
        const sessionHeader = this.formatLine("INFO", "Session start", {
            platform: process.platform,
            pid: process.pid,
        });
        await fs.appendFile(this.logFilePath, `${sessionHeader}\n`);
    }

    private async writeMetadataHeader(): Promise<void> {
        if (this.logFilePath === undefined || this.context === undefined) {
            return;
        }
        const metadata: Metadata = {
            extensionId: this.context.extension.id,
            extensionVersion: this.context.extension.packageJSON?.version ?? "unknown",
            vscodeVersion: vscode.version,
            platform: process.platform,
            createdAt: new Date().toISOString(),
        };

        const header = [
            "================= Analog Attach Log =================",
            `extension: ${metadata.extensionId}@${metadata.extensionVersion}`,
            `vscode: ${metadata.vscodeVersion}`,
            `platform: ${metadata.platform}`,
            `started: ${metadata.createdAt}`,
            "=====================================================",
        ].join("\n");

        await fs.writeFile(this.logFilePath, `${header}\n`, { flag: "w" });
    }

    private formatLine(level: LogLevel, message: string, data?: unknown): string {
        const timestamp = new Date().toISOString();
        const serialized = data === undefined ? "" : ` ${this.safeStringify(data)}`;
        return `[${timestamp}] [${level}] ${message}${serialized}`;
    }

    private safeStringify(data: unknown): string {
        try {
            return JSON.stringify(data, bigIntReplacer);
        } catch {
            return String(data);
        }
    }

    private writeToConsole(level: LogLevel, line: string): void {
        switch (level) {
            case "ERROR": {
                console.error(line);
                break;
            }
            case "WARN": {
                console.warn(line);
                break;
            }
            default: {
                console.log(line);
                break;
            }
        }
    }
}

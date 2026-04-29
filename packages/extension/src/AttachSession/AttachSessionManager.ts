import * as vscode from "vscode";
import * as fs from 'node:fs';
import path = require("node:path");
import { expand_tilde_if_present } from "../utilities";
import { AttachSession } from "./AttachSession";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { DTSO_BASE_MAP_KEY } from "../constants";

/**
 * Manages multiple AttachSession instances, one per file.
 * This replaces the singleton pattern to allow independent editing of multiple DTS files.
 */
export class AttachSessionManager {
    private static instance: AttachSessionManager | undefined;
    private sessions: Map<string, AttachSession> = new Map();
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): AttachSessionManager {
        if (!AttachSessionManager.instance) {
            AttachSessionManager.instance = new AttachSessionManager(context);
        }
        return AttachSessionManager.instance;
    }

    /**
     * Gets or creates an AttachSession for the specified file URI.
     * Each file gets its own independent AttachSession instance.
     * @throws Error if the VSCode variables are not correct
     */
    public async getOrCreateSession(fileUri: vscode.Uri): Promise<AttachSession> {
        const filePath = fileUri.fsPath;

        // Check if we already have a session for this file
        if (this.sessions.has(filePath)) {
            AnalogAttachLogger.debug("Reusing AttachSession", { filePath });
            return this.sessions.get(filePath) as AttachSession;
        }

        // Create a new session for this file
        const session = await this.createSessionForFile(fileUri);
        await this.restoreDtsoBaseMappingIfNeeded(session, fileUri);
        AnalogAttachLogger.info("Created AttachSession", { filePath });
        this.sessions.set(filePath, session);
        return session;
    }

    /**
     * Removes a session for the specified file URI.
     * Called when a file is closed.
     */
    public removeSession(fileUri: vscode.Uri): void {
        const filePath = fileUri.fsPath;
        this.sessions.delete(filePath);
        AnalogAttachLogger.debug("Removed AttachSession", { filePath });
    }

    /**
     * Gets the session for a specific file, if it exists.
     */
    public getSession(fileUri: vscode.Uri): AttachSession | undefined {
        return this.sessions.get(fileUri.fsPath);
    }

    /**
     * Creates a new AttachSession instance for the specified file.
     */
    private async createSessionForFile(fileUri: vscode.Uri): Promise<AttachSession> {
        const config = vscode.workspace.getConfiguration('analog-attach');
        const default_linux_path = config.get<string>('defaultLinuxRepository');

        if (!default_linux_path) {
            const choice = await vscode.window.showErrorMessage(
                "Analog Attach: 'analog-attach.defaultLinuxRepository' is not set. Configure it to point to a Linux source tree.",
                "Open Settings"
            );
            if (choice === "Open Settings") {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'analog-attach.defaultLinuxRepository');
            }
            throw new Error("Analog Attach: 'analog-attach.defaultLinuxRepository' is not set. Configure it to point to a Linux source tree.");
        }

        const linux_path = expand_tilde_if_present(default_linux_path);
        const linux_bindings_folder = path.join(linux_path, 'Documentation', 'devicetree', 'bindings');

        const default_dt_schema_path = config.get<string>('defaultDtSchemaRepository');
        const bundled_dt_schema_path = path.join(this.context.extensionPath, 'packages', 'extension', 'resources', 'dt-schema');
        const dt_schema_path = default_dt_schema_path
            ? expand_tilde_if_present(default_dt_schema_path)
            : bundled_dt_schema_path;

        if (!fs.existsSync(linux_bindings_folder)) {
            const reason = `Analog Attach needs the linux kernel repository of the target device. The analog-attach.defaultLinuxRepository is currently set as ${linux_bindings_folder}.\n\nPlease reopen the file after setting a valid path.`;
            const choice = await vscode.window.showErrorMessage(
                `${reason}. Configure analog-attach.defaultLinuxRepository to a valid Linux kernel repository.`,
                "Open Settings"
            );
            if (choice === "Open Settings") {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'analog-attach.defaultLinuxRepository');
            }
            throw new Error(reason);
        }

        if (!fs.existsSync(dt_schema_path)) {
            if (default_dt_schema_path) {
                throw new Error(`Analog Attach: dt-schema repo does not exist at ${dt_schema_path}`);
            }
            throw new Error(`Analog Attach: Bundled dt-schema repo does not exist at ${dt_schema_path}`);
        }

        // Ensure global storage directory exists
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(globalStoragePath)) {
            fs.mkdirSync(globalStoragePath, { recursive: true });
        }

        // Create a new AttachSession instance for this file
        return await AttachSession.createForFile(
            fileUri,
            linux_bindings_folder,
            linux_path,
            dt_schema_path,
            globalStoragePath,
            this.context.globalState
        );
    }

    private async restoreDtsoBaseMappingIfNeeded(session: AttachSession, fileUri: vscode.Uri): Promise<void> {
        if (!session.is_dtso_session()) {
            return;
        }

        if (session.get_base_device_tree_path()) {
            return;
        }

        const config = vscode.workspace.getConfiguration('analog-attach');
        const autoMergeEnabled = config.get<boolean>('enableAutoMergeDtsoBase', true);
        if (!autoMergeEnabled) {
            return;
        }

        const dtsoText = session.get_original_dtso_content();
        if (!dtsoText) {
            return;
        }

        const baseMap = this.context.globalState.get<Record<string, string>>(DTSO_BASE_MAP_KEY) ?? {};
        const basePath = baseMap[fileUri.fsPath];
        if (!basePath) {
            return;
        }

        if (!fs.existsSync(basePath)) {
            delete baseMap[fileUri.fsPath];
            await this.context.globalState.update(DTSO_BASE_MAP_KEY, baseMap);
            AnalogAttachLogger.warn("Saved DTS base path no longer exists; skipping auto-merge", {
                dtso: fileUri.fsPath,
                basePath
            });
            return;
        }

        try {
            await session.merge_dtso_with_base_dts(basePath, dtsoText);
            AnalogAttachLogger.info("Auto-merged DTSO with remembered base DTS", {
                dtso: fileUri.fsPath,
                basePath
            });
        } catch (error) {
            AnalogAttachLogger.warn("Failed to auto-merge DTSO with remembered base DTS", {
                dtso: fileUri.fsPath,
                basePath,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Disposes all sessions and cleans up resources.
     */
    public dispose(): void {
        this.sessions.clear();
        AttachSessionManager.instance = undefined;
    }
}

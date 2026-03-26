import * as vscode from 'vscode';
import * as fs from 'node:fs';
import path = require('node:path');
import { AttachSessionManager } from './AttachSession/AttachSessionManager';
import { AnalogAttachLogger } from './AnalogAttachLogger';
import { DtsCustomEditorProvider } from './DtsCustomEditor';
import { DtsPlugAndPlayCustomEditorProvider } from './DtsPlugAndPlayCustomEditor';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { AnalogAttachSidebarProvider } from './sidebar/AnalogAttachSidebar';
import { DTSO_BASE_MAP_KEY, EXTENSION_SETTING_PREFIX } from './constants';
import { NavigationCommands } from 'extension-protocol';

export async function activate(context: vscode.ExtensionContext) {
    // Init the Logger with the context on first activation
    AnalogAttachLogger.getInstance(context);
    AnalogAttachLogger.info(`Analog Attach log file: ${AnalogAttachLogger.getLogFilePath()}`).catch(console.error);

    // Init the Logger with the context on first activation
    AnalogAttachLogger.getInstance(context);
    AnalogAttachLogger.info(`Analog Attach log file: ${AnalogAttachLogger.getLogFilePath()}`).catch(console.error);

    // Change the preprocess command based on the OS
    const config = vscode.workspace.getConfiguration(EXTENSION_SETTING_PREFIX);
    const inspection = config.inspect<string>("preprocessDtsFilesCommand");

    if (inspection?.globalValue || inspection?.workspaceValue || inspection?.workspaceFolderValue) {
        const default_command = process.platform === 'linux'
            ? 'gcc -E -I{include_dir_path} -I{arch_dir_path} -undef -x assembler-with-cpp'
            : 'cpp -nostdinc -I {include_dir_path} -I {arch_dir_path} -undef -x assembler-with-cpp';

        await config.update('preprocessDtsFilesCommand', default_command, vscode.ConfigurationTarget.Global);
    }

    const add_device_tree_command = vscode.commands.registerCommand(`${EXTENSION_SETTING_PREFIX}.addDeviceTree`, async () => {
        AnalogAttachLogger.userAction('command', { command: `${EXTENSION_SETTING_PREFIX}.addDeviceTree` }).catch(console.error);
        try {
            let targetUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;

            // Fallback for custom editors (plug-and-play or advanced tree editor)
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (!targetUri && activeTab?.input instanceof vscode.TabInputCustom) {
                const viewType = activeTab.input.viewType;
                if (viewType === `${EXTENSION_SETTING_PREFIX}.dtsEditor` || viewType === `${EXTENSION_SETTING_PREFIX}.dtsPlugAndPlayEditor`) {
                    targetUri = activeTab.input.uri;
                }
            }

            if (!targetUri) {
                AnalogAttachLogger.warn("addDeviceTree: no active document");
                vscode.window.showErrorMessage("Open a DTSO overlay to merge a base DTS file.");
                return;
            }

            if (!targetUri.fsPath.toLowerCase().endsWith('.dtso')) {
                AnalogAttachLogger.warn("addDeviceTree: unsupported file type", { file: targetUri.fsPath });
                vscode.window.showErrorMessage("This command is only available when a .dtso overlay is open.");
                return;
            }

            const sessionManager = AttachSessionManager.getInstance(context);
            const session = await sessionManager.getOrCreateSession(targetUri);

            if (!session.is_dtso_session()) {
                vscode.window.showErrorMessage("This command can only run in a DTSO overlay session.");
                return;
            }

            const dtsPick = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select DTS base',
                filters: {
                    'Device Tree Source': ['dts'],
                    'All Files': ['*'],
                },
            });

            if (!dtsPick || !dtsPick[0]) {
                AnalogAttachLogger.info("addDeviceTree: user cancelled base selection");
                return;
            }

            const dtsoDocument = await vscode.workspace.openTextDocument(targetUri);
            let dtsoOverlayText = dtsoDocument.getText();

            // Ensure minimal DTSO scaffold so merge works even if the overlay is empty
            const trimmed = dtsoOverlayText.trim();
            if (!/\/dts-v1\//.test(dtsoOverlayText) || !/\/plugin\//.test(dtsoOverlayText) || trimmed.length === 0) {
                const scaffold = String.raw`/dts-v1/;
/plugin/;

/ {};`;
                dtsoOverlayText = trimmed.length === 0 ? scaffold : `${scaffold}\n${dtsoOverlayText}`;
            }

            await session.merge_dtso_with_base_dts(dtsPick[0].fsPath, dtsoOverlayText);
            const dtsoBaseMap = context.globalState.get<Record<string, string>>(DTSO_BASE_MAP_KEY) ?? {};
            dtsoBaseMap[targetUri.fsPath] = dtsPick[0].fsPath;
            await context.globalState.update(DTSO_BASE_MAP_KEY, dtsoBaseMap);

            // If the active tab is a custom editor, ask VS Code to refresh the webview to reflect the merge.
            if (activeTab?.input instanceof vscode.TabInputCustom &&
                (
                    activeTab.input.viewType === `${EXTENSION_SETTING_PREFIX}.dtsEditor` ||
                    activeTab.input.viewType === `${EXTENSION_SETTING_PREFIX}.dtsPlugAndPlayEditor`)
            ) {
                await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
            }

            vscode.window.showInformationMessage(`Merged ${path.basename(dtsPick[0].fsPath)} into ${path.basename(targetUri.fsPath)}.`);
        } catch (error) {
            AnalogAttachLogger.error("addDeviceTree failed", { error: error instanceof Error ? error.message : String(error) });
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to merge DTS into DTSO: ${message}`);
            AnalogAttachLogger.error("User-facing error message", { message: `Failed to merge DTS into DTSO: ${message}` });
        }
    });

    const compile_device_tree_command = vscode.commands.registerCommand(`${EXTENSION_SETTING_PREFIX}.compileDeviceTree`, async () => {
        AnalogAttachLogger.userAction('command', { command: `${EXTENSION_SETTING_PREFIX}.compileDeviceTree` }).catch(console.error);
        try {
            let targetUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;

            // Fallback for custom editors (plug-and-play or advanced tree editor)
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (!targetUri && activeTab?.input instanceof vscode.TabInputCustom) {
                const viewType = activeTab.input.viewType;
                if (
                    viewType === `${EXTENSION_SETTING_PREFIX}.dtsEditor` ||
                    viewType === `${EXTENSION_SETTING_PREFIX}.dtsPlugAndPlayEditor`
                ) {
                    targetUri = activeTab.input.uri;
                }
            }

            if (!targetUri) {
                AnalogAttachLogger.warn("compileDeviceTree: no active document");
                vscode.window.showErrorMessage("Open a DTS or DTSO file to compile.");
                return;
            }

            const filePath = targetUri.fsPath;
            const fileExtension = path.extname(filePath).toLowerCase();

            if (fileExtension !== '.dts' && fileExtension !== '.dtso') {
                AnalogAttachLogger.warn("compileDeviceTree: unsupported file type", { file: filePath });
                vscode.window.showErrorMessage("This command is only available for .dts or .dtso files.");
                return;
            }

            const sessionManager = AttachSessionManager.getInstance(context);
            try {
                const session = await sessionManager.getOrCreateSession(targetUri);
                const hasErrors = session.hasValidationErrors();
                if (hasErrors) {
                    const errorCount = session.getValidationErrorCount();
                    const choice = await vscode.window.showWarningMessage(
                        `${errorCount} configuration error(s) detected. Do you want to compile anyway?`,
                        "Compile Anyway",
                        "Cancel"
                    );
                    if (choice !== "Compile Anyway") {
                        return;
                    }
                }
            } catch (error) {
                AnalogAttachLogger.warn("compileDeviceTree: validation check skipped", { error: error instanceof Error ? error.message : String(error) });
            }

            // Get the compile command from configuration
            const config = vscode.workspace.getConfiguration(EXTENSION_SETTING_PREFIX);
            const compileCommand = config.get<string>('compileDtsFileCommand', 'dtc -O dtb -I dts');

            // Determine output file path (replace .dts/.dtso with .dtb/.dtbo)
            const fileDirectory = path.dirname(filePath);
            const baseName = path.basename(filePath, fileExtension);
            let outputExtension: string;

            if (fileExtension === ".dtso") {
                outputExtension = "dtbo";
            } else {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                outputExtension = /\/plugin\//.test(fileContent) ? "dtbo" : "dtb";
            }
            const outputPath = path.join(fileDirectory, `${baseName}.${outputExtension}`);

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Compiling Device Tree",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: `Compiling ${path.basename(filePath)}...` });

                try {
                    // Import child_process module
                    const execAsync = promisify(exec);

                    // Build the full command: dtc -O dtb -I dts input.dts -o output.dtb
                    const fullCommand = `${compileCommand} "${filePath}" -o "${outputPath}"`;

                    // Execute the compilation command
                    const result = await execAsync(fullCommand, {
                        cwd: fileDirectory, // Run in the same directory as the source file
                    });

                    // Check if output file was created
                    if (fs.existsSync(outputPath)) {
                        vscode.window.showInformationMessage(
                            `Successfully compiled ${path.basename(filePath)} to ${path.basename(outputPath)}`
                        );
                    } else {
                        throw new Error("Compilation completed but output file was not created");
                    }

                    // Log any warnings from dtc
                    if (result.stderr && result.stderr.trim()) {
                        console.log('DTC warnings/info:', result.stderr);
                    }

                } catch (execError: any) {
                    let errorMessage = "Compilation failed";

                    if (execError.stderr) {
                        // Extract meaningful error from dtc stderr
                        const stderr = execError.stderr.toString();
                        errorMessage = `Compilation failed: ${stderr}`;
                    } else if (execError.message) {
                        errorMessage = `Compilation failed: ${execError.message}`;
                    }

                    throw new Error(errorMessage);
                }
            });

        } catch (error) {
            AnalogAttachLogger.error("compileDeviceTree failed", { error: error instanceof Error ? error.message : String(error) });
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(message);
            AnalogAttachLogger.error("User-facing error message", { message });
        }
    });

    const deploy_device_tree_command = vscode.commands.registerCommand(`${EXTENSION_SETTING_PREFIX}.deployDeviceTree`, async () => {
        AnalogAttachLogger.userAction('command', { command: `${EXTENSION_SETTING_PREFIX}.deployDeviceTree` }).catch(console.error);
        try {
            let targetUri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri;

            // Fallback for custom editors (plug-and-play or advanced tree editor)
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (!targetUri && activeTab?.input instanceof vscode.TabInputCustom) {
                const viewType = activeTab.input.viewType;
                if (viewType === `${EXTENSION_SETTING_PREFIX}.dtsEditor` || viewType === `${EXTENSION_SETTING_PREFIX}.dtsPlugAndPlayEditor`) {
                    targetUri = activeTab.input.uri;
                }
            }

            if (!targetUri) {
                AnalogAttachLogger.warn("deployDeviceTree: no active document");
                vscode.window.showErrorMessage("Open a DTS, DTSO, or DTB file to deploy.");
                return;
            }

            const filePath = targetUri.fsPath;
            const fileExtension = path.extname(filePath).toLowerCase();

            let dtbFilePath: string;

            // Determine the DTB file path
            switch (fileExtension) {
                case '.dtb':
                case '.dtbo': {
                    // Already a binary file
                    dtbFilePath = filePath;
                }
                case '.dts': {
                    // Look for corresponding .dtb file
                    const fileDirectory = path.dirname(filePath);
                    const baseName = path.basename(filePath, fileExtension);
                    dtbFilePath = path.join(fileDirectory, `${baseName}.dtb`);
                    break;
                }
                case '.dtso': {
                    // Look for corresponding .dtbo file
                    const fileDirectory = path.dirname(filePath);
                    const baseName = path.basename(filePath, fileExtension);
                    dtbFilePath = path.join(fileDirectory, `${baseName}.dtbo`);
                    break;
                }
                default: {
                    AnalogAttachLogger.warn("deployDeviceTree: unsupported file type", { file: filePath });
                    vscode.window.showErrorMessage("This command is only available for .dts, .dtso, .dtb, or .dtbo files.");
                    return;
                }
            }

            // Check if DTB file exists
            if (!fs.existsSync(dtbFilePath)) {
                const missingFileName = path.basename(dtbFilePath);
                const shouldCompile = await vscode.window.showWarningMessage(
                    `Binary file ${missingFileName} not found. Would you like to compile it first?`,
                    "Compile & Deploy",
                    "Cancel"
                );

                if (shouldCompile === "Compile & Deploy") {
                    // Compile first, then deploy
                    await vscode.commands.executeCommand(`${EXTENSION_SETTING_PREFIX}.compileDeviceTree`);

                    // Check again if DTB was created
                    if (!fs.existsSync(dtbFilePath)) {
                        AnalogAttachLogger.error("deployDeviceTree: compile step failed, dtb missing", { dtbFilePath });
                        vscode.window.showErrorMessage("Compilation failed. Cannot deploy.");
                        return;
                    }
                } else {
                    return;
                }
            }

            // Get configuration for deployment
            const config = vscode.workspace.getConfiguration(EXTENSION_SETTING_PREFIX);
            const remoteHost = config.get<string>('remoteHost');
            const remoteUser = config.get<string>('remoteUser');
            const remotePassword = config.get<string>('remotePassword');
            let sshConfig = config.get<string>('sshConfig');
            let sshpassConfig = config.get<string>('sshpassConfig');
            const remoteSudoAuth = config.get<string>('remoteSudoAuth');
            const writeDtbToOverlays = config.get<string>('writeDtbToOverlays');
            const rebootDevice = config.get<string>('rebootDevice');

            // Validate required configuration
            if (!sshpassConfig) {
                vscode.window.showErrorMessage(
                    `Device tree deployment requires configuration. Please set ${EXTENSION_SETTING_PREFIX}.remotePassword (or sshpassConfig).`
                );
                return;
            }

            if (!sshConfig) {
                vscode.window.showErrorMessage(
                    `Device tree deployment requires configuration. Please set ${EXTENSION_SETTING_PREFIX}.remoteHost and ${EXTENSION_SETTING_PREFIX}.remoteUser (or sshConfig).`
                );
                return;
            }

            if (remoteSudoAuth === undefined) {
                vscode.window.showErrorMessage(
                    `Device tree deployment requires configuration. Please set the following in VS Code settings: remoteSudoAuth`
                );
                return;
            }

            if (writeDtbToOverlays === undefined) {
                vscode.window.showErrorMessage(
                    `Device tree deployment requires configuration. Please set the following in VS Code settings: writeDtbToOverlays`
                );
                return;
            }

            if (rebootDevice === undefined) {
                vscode.window.showErrorMessage(
                    `Device tree deployment requires configuration. Please set the following in VS Code settings: rebootDevice`
                );
                return;
            }

            // Apply replacements
            if (remoteUser !== undefined) {
                sshConfig = sshConfig.replace("{remoteUser}", remoteUser);
            }
            if (remoteHost !== undefined) {
                sshConfig = sshConfig.replace("{remoteHost}", remoteHost);
            }
            if (remotePassword !== undefined) {
                sshpassConfig = sshpassConfig.replace("{remotePassword}", remotePassword);
            }

            const dtbFileName = path.basename(dtbFilePath);

            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Deploying Device Tree",
                cancellable: false
            }, async (progress) => {

                try {
                    const execAsync = promisify(exec);

                    // Step 1: Deploy DTB file to remote device
                    progress.report({ message: `Uploading ${dtbFileName}...` });

                    // Replace {dtb_name} placeholder in the write command
                    const writeCommand = writeDtbToOverlays.replace('{dtb_name}', dtbFileName);

                    // Build the full deployment command:
                    // sshpass -p analog ssh user@address 'sudo tee /boot/overlays/{name} > /dev/null' < {local_file}
                    const remoteWriteCommand = remoteSudoAuth && remoteSudoAuth.trim().length > 0
                        ? `${remoteSudoAuth} ${writeCommand}`
                        : writeCommand;
                    const sshWriteCommand = sshConfig.replace('{command}', remoteWriteCommand);
                    const deployCommand = `${sshpassConfig} ${sshWriteCommand} < "${dtbFilePath}"`;

                    await execAsync(deployCommand);

                    vscode.window.showInformationMessage(`Successfully deployed ${dtbFileName} to device`);

                    // Step 2: Ask user if they want to reboot the device
                    const shouldReboot = await vscode.window.showInformationMessage(
                        "Device tree deployed successfully. Reboot the device to apply changes?",
                        "Reboot Now",
                        "Skip Reboot"
                    );

                    if (shouldReboot === "Reboot Now") {
                        progress.report({ message: "Rebooting device..." });

                        // Build reboot command
                        const sshRebootCommand = sshConfig
                            .replace('{command}', `${remoteSudoAuth} ${rebootDevice}`);
                        const rebootCommand = `${sshpassConfig} ${sshRebootCommand}`;

                        // Execute reboot command (don't wait for response as device will disconnect)
                        execAsync(rebootCommand).catch(() => {
                            // Expected to fail as device reboots and disconnects
                        });

                        vscode.window.showInformationMessage("Device reboot initiated. Please wait for the device to come back online.");
                    }

                } catch (execError: any) {
                    let errorMessage = "Deployment failed";

                    if (execError.stderr) {
                        const stderr = execError.stderr.toString();
                        errorMessage = `Deployment failed: ${stderr}`;
                    } else if (execError.message) {
                        errorMessage = `Deployment failed: ${execError.message}`;
                    }

                    throw new Error(errorMessage);
                }
            });

        } catch (error) {
            AnalogAttachLogger.error("deployDeviceTree failed", { error: error instanceof Error ? error.message : String(error) });
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(message);
            AnalogAttachLogger.error("User-facing error message", { message });
        }
    });

    // Create instance-based providers so we can access the active panel
    const dtsProvider = new DtsCustomEditorProvider(context);
    const pnpProvider = new DtsPlugAndPlayCustomEditorProvider(context);

    const navigateBack = vscode.commands.registerCommand(`${EXTENSION_SETTING_PREFIX}.navigateBack`, () => {
        const panel = dtsProvider.getActivePanel();
        if (!panel) {
            return;
        }

        panel?.webview.postMessage({
            command: NavigationCommands.navigateBack,
            type: 'notification',
            payload: {},
        });
    });

    const navigateForward = vscode.commands.registerCommand(`${EXTENSION_SETTING_PREFIX}.navigateForward`, () => {
        const panel = dtsProvider.getActivePanel();
        if (!panel) {
            return;
        }

        panel?.webview.postMessage({
            command: NavigationCommands.navigateForward,
            type: 'notification',
            payload: {},
        });
    });

    context.subscriptions.push(
        dtsProvider.register(),
        pnpProvider.register(),
        add_device_tree_command,
        compile_device_tree_command,
        deploy_device_tree_command,
        navigateBack,
        navigateForward,
        vscode.window.registerWebviewViewProvider(
            "analog-attach-sidebar-view",
            new AnalogAttachSidebarProvider(context.extensionUri, context),
            { webviewOptions: { retainContextWhenHidden: true } }
        ),
    );

    return;
}

export function deactivate() { }

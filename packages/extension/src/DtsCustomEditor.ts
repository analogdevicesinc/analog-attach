import * as vscode from 'vscode';
import { TreeConfigController } from './WebviewControllers/TreeConfigController';
import { AttachSessionManager } from './AttachSession/AttachSessionManager';
import { EventCommands, type FileChangedNotification } from 'extension-protocol';

// This class is responsible with implementing the custom text editor with the same
// view as the "Attach linux repo" legacy command.
export class DtsCustomEditorProvider implements vscode.CustomTextEditorProvider {

    private static readonly viewType = 'analog-attach.dtsEditor';

    private activePanel: vscode.WebviewPanel | undefined;

    constructor(private readonly context: vscode.ExtensionContext) { }

    public getActivePanel(): vscode.WebviewPanel | undefined {
        return this.activePanel;
    }

    public register(): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            DtsCustomEditorProvider.viewType,
            this
        );
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const local_resources: Map<string, vscode.Uri> = new Map([
            ["media", vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'extension', 'media')],
            ["script", vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'tree-editor-webview', 'dist')],
            ["codicons", vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'tree-editor-webview', 'dist', 'codicons')]
        ]);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [...local_resources.values()]
        };

        try {
            // Get or create an AttachSession for this specific file
            const sessionManager = AttachSessionManager.getInstance(this.context);
            const attachSession = await sessionManager.getOrCreateSession(document.uri);

            // Create a TreeConfigController for this specific session
            const webviewController = TreeConfigController.createForSession(attachSession);

            const nonce = this.getNonce();
            webviewPanel.webview.html = webviewController.get_html_for_webview(webviewPanel.webview, nonce, local_resources);

            // Track the active panel for navigation commands
            this.activePanel = webviewPanel;
            webviewPanel.onDidChangeViewState(() => {
                if (webviewPanel.active) {
                    this.activePanel = webviewPanel;
                }
            });

            // Set up message handling using the TreeConfigController
            webviewPanel.webview.onDidReceiveMessage(
                message => {
                    webviewController.handle_message(message, webviewPanel);
                }
            );

            let disposed = false;
            let refreshTimeout: NodeJS.Timeout | undefined;
            let latestDocumentText = document.getText();

            const sendFileChangedNotification = (): void => {
                const notification: FileChangedNotification = {
                    id: `${EventCommands.fileChanged}-${Date.now()}`,
                    type: "notification",
                    timestamp: new Date().toISOString(),
                    command: EventCommands.fileChanged,
                    payload: {
                        filePath: document.uri.fsPath,
                        changeSource: "external",
                    },
                };

                webviewPanel.webview.postMessage(notification);
            };

            const scheduleRefresh = (updatedText: string) => {
                latestDocumentText = updatedText;
                if (refreshTimeout) {
                    clearTimeout(refreshTimeout);
                }

                refreshTimeout = setTimeout(async () => {
                    if (disposed) {
                        return;
                    }

                    try {
                        await attachSession.reloadFromText(latestDocumentText);
                        webviewController.pushDeviceTreeUpdate(webviewPanel);
                        sendFileChangedNotification();
                        webviewPanel.webview.postMessage({
                            id: `${EventCommands.fileChanged}-${Date.now()}`,
                            type: "notification",
                            timestamp: new Date().toISOString(),
                            command: EventCommands.fileChanged,
                            payload: {}
                        });
                    } catch (error) {
                        console.error('Failed to refresh device tree after external change:', error);
                        const message = error instanceof Error ? error.message : 'Unknown error occurred';
                        vscode.window.showErrorMessage(`Failed to reload device tree: ${message}`);
                    }
                }, 400);
            };

            // Refresh when VS Code reloads the document (not on live typing) — detect clean changes
            const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === document.uri.toString()) {
                    if (attachSession.consumeFileChangeNotificationSuppression()) {
                        return;
                    }
                    if (event.document.isDirty) {
                        return; // skip live edits; wait for save/reload
                    }
                    scheduleRefresh(event.document.getText());
                }
            });

            webviewPanel.onDidDispose(() => {
                disposed = true;
                sessionManager.removeSession(document.uri);
                changeDocumentSubscription.dispose();
                if (refreshTimeout) {
                    clearTimeout(refreshTimeout);
                }
            });

        } catch (error) {
            console.error('Error creating custom editor:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            webviewPanel.webview.html = this.getErrorHtml(`Failed to initialize device tree session: ${errorMessage}`);
        }
    }


    private getErrorHtml(message: string): string {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>DTS Editor - Error</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                        margin: 0;
                    }

                    .error-container {
                        text-align: center;
                        padding: 40px;
                    }

                    .error-message {
                        color: var(--vscode-errorForeground);
                        font-size: 1.1em;
                        margin-bottom: 20px;
                    }

                    .instructions {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.9em;
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1>DTS Editor</h1>
                    <div class="error-message">${message}</div>
                    <div class="instructions">
                        Something did not initialize correctly, please reopen the file and if the issue persists, contact the developers at https://github.com/analogdevicesinc/analog-attach/issues/new
                    </div>
                </div>
            </body>
            </html>`;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let index = 0; index < 32; index++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

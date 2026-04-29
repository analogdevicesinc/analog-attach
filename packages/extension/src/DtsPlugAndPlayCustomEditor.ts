import * as vscode from 'vscode';
import { PlugAndPlayWebviewController } from './WebviewControllers/PlugAndPlayWebviewController';
import { AttachSessionManager } from './AttachSession/AttachSessionManager';
import { EventCommands, type FileChangedNotification } from 'extension-protocol';
import { AnalogAttachLogger } from './AnalogAttachLogger';

export class DtsPlugAndPlayCustomEditorProvider implements vscode.CustomTextEditorProvider {

    private static readonly viewType = 'analog-attach.dtsPlugAndPlayEditor';

    private activePanel: vscode.WebviewPanel | undefined;

    constructor(private readonly context: vscode.ExtensionContext) { }

    public getActivePanel(): vscode.WebviewPanel | undefined {
        return this.activePanel;
    }

    public register(): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            DtsPlugAndPlayCustomEditorProvider.viewType,
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
            ["script", vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'pnp-webview', 'dist')],
            ["codicons", vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'pnp-webview', 'dist', 'codicons')]
        ]);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [...local_resources.values()]
        };

        try {
            const sessionManager = AttachSessionManager.getInstance(this.context);
            const attachSession = await sessionManager.getOrCreateSession(document.uri);

            // Create a PlugAndPlayWebviewController for the simple interface
            const webviewController = PlugAndPlayWebviewController.create(attachSession);

            const nonce = this.getNonce();
            webviewPanel.webview.html = webviewController.get_html_for_webview(webviewPanel.webview, nonce, local_resources);

            // Track the active panel for navigation commands
            this.activePanel = webviewPanel;
            webviewPanel.onDidChangeViewState(() => {
                if (webviewPanel.active) {
                    this.activePanel = webviewPanel;
                }
            });

            // Set up message handling using the PlugAndPlayWebviewController
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
                        AnalogAttachLogger.info("File change detected; reloaded session", { file: document.uri.fsPath });
                        sendFileChangedNotification();
                        webviewPanel.webview.postMessage({ type: EventCommands.fileChanged });
                    } catch (error) {
                        AnalogAttachLogger.error('Plug and Play: Failed to refresh after external file change', { file: document.uri.fsPath, error: error instanceof Error ? error.message : String(error) });
                        const message = error instanceof Error ? error.message : 'Unknown error occurred';
                        vscode.window.showErrorMessage(`Failed to reload device tree: ${message}`);
                        AnalogAttachLogger.error('User-facing error message', { message: `Failed to reload device tree: ${message}` });
                    }
                }, 400);
            };

            // Listen for document changes to potentially show updates
            const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === document.uri.toString()) {
                    if (attachSession.consumeFileChangeNotificationSuppression()) {
                        return;
                    }
                    scheduleRefresh(event.document.getText());
                }
            });

            webviewPanel.onDidDispose(() => {
                disposed = true;
                sessionManager.removeSession(document.uri);
                webviewController.dispose();
                changeDocumentSubscription.dispose();
                if (refreshTimeout) {
                    clearTimeout(refreshTimeout);
                }
            });

        } catch (error) {
            AnalogAttachLogger.error('Error creating plug and play custom editor', { file: document.uri.fsPath, error: error instanceof Error ? error.message : String(error) });
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            AnalogAttachLogger.error('User-facing error message', { message: `Failed to initialize device tree session: ${errorMessage}` });
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
                <title>DTS Plug and Play Editor - Error</title>
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
                    <h1>DTS Plug and Play Editor</h1>
                    <div class="error-message">${message}</div>
                    <div class="instructions">
                        Try using the "Advanced device tree editor" instead by right-clicking and selecting "Reopen with".
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

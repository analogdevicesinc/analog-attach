import * as vscode from "vscode";

export interface WebviewControllerInterface {
    handle_message(message: any, panel: vscode.WebviewPanel): void,
    get_html_for_webview(webview: vscode.Webview, nonce: string, local_resources: Map<string, vscode.Uri>): string,
    dispose(): void
}
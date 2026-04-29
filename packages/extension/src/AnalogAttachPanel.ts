import * as vscode from "vscode";

import { WebviewControllerInterface } from "./WebviewControllers/WebviewControllerInterface";

// This is more of a legacy class, responsible with enabling the "Attach linux repo" command
// It is still kept for testing purposes, but will be removed in the final version of the app
export class AnalogAttachPanel {

    public static currentPanel: AnalogAttachPanel | undefined;

    public static readonly viewType = "analog-attach";
    private readonly _panel: vscode.WebviewPanel;
    private readonly _webview_controller: WebviewControllerInterface;

    private readonly local_resources: Map<string, vscode.Uri>;

    private _disposables: vscode.Disposable[] = [];

    public static create_or_show(extensionUri: vscode.Uri, webview_controller: WebviewControllerInterface) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (AnalogAttachPanel.currentPanel) {
            AnalogAttachPanel.currentPanel._panel.reveal(column);
            AnalogAttachPanel.currentPanel._update();
            return;
        }

        const local_resources: Map<string, vscode.Uri> = new Map([
            ["media", vscode.Uri.joinPath(extensionUri, 'packages', 'extension', 'media')],
            ["script", vscode.Uri.joinPath(extensionUri, 'packages', 'pnp-webview', 'dist')],
            ["codicons", vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')]
        ]);

        const panel = vscode.window.createWebviewPanel(
            AnalogAttachPanel.viewType,
            "Analog Attach",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [...local_resources.values()],
                retainContextWhenHidden: true
            }
        );

        AnalogAttachPanel.currentPanel = new AnalogAttachPanel(panel, webview_controller, local_resources);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        webview_controller: WebviewControllerInterface,
        local_resources: Map<string, vscode.Uri>
    ) {
        this._panel = panel;
        this._webview_controller = webview_controller;
        this.local_resources = local_resources;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), undefined, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                this._webview_controller.handle_message(message, this._panel);
            },
            undefined,
            this._disposables
        );

    }

    public dispose() {
        AnalogAttachPanel.currentPanel = undefined;

        this._panel.dispose();
        this._webview_controller.dispose();

        while (this._disposables.length > 0) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._get_html_for_webview(webview, this.local_resources);
    }

    private _get_html_for_webview(webview: vscode.Webview, local_resources: Map<string, vscode.Uri>) {

        const nonce = AnalogAttachPanel._get_nonce();

        return this._webview_controller.get_html_for_webview(webview, nonce, local_resources);
    }

    private static _get_nonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let index = 0; index < 32; index++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

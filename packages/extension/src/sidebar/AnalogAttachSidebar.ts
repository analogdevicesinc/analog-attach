import * as vscode from "vscode";
import path from "node:path";
import { EventCommands } from "extension-protocol";
import { EXTENSION_ID } from "../constants";
import { AttachSessionManager } from "../AttachSession/AttachSessionManager";

export class AnalogAttachSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "analog-attach-sidebar-view";

    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) { }

    resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
        this.view = webviewView;

        const webview = webviewView.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webview.html = this.getHtml(webview);

        webview.onDidReceiveMessage(async (message) => {
            switch (message?.command) {
                case "merge": {
                    await vscode.commands.executeCommand("analog-attach.addDeviceTree");
                    break;
                }
                case "compile": {
                    await vscode.commands.executeCommand("analog-attach.compileDeviceTree");
                    break;
                }
                case "deploy": {
                    await vscode.commands.executeCommand("analog-attach.deployDeviceTree");
                    break;
                }
                case "openSettings": {
                    await vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${EXTENSION_ID}`);
                    break;
                }
                case "toggleView": {
                    await this.toggleActiveView();
                    break;
                }
                case "updateSetting": {
                    await this.handleSettingUpdate(message.key, message.value, webview);
                    break;
                }
                case "refresh": {
                    this.postRefresh();
                    break;
                }
                default: {
                    break;
                }
            }
        });

        this.context.subscriptions.push(
            webviewView.onDidDispose(() => { this.view = undefined; }),
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.postRefresh();
            })
        );
    }

    private collectInfo(): {
        sshConfig?: string;
        sshpass?: string;
        remoteHost?: string;
        remoteUser?: string;
        remotePassword?: string;
        isDtsoFile?: boolean;
        mergedBaseDtsPath?: string;
        mergedBaseDtsFullPath?: string;
    } {
        const config = vscode.workspace.getConfiguration("analog-attach");

        const result: ReturnType<AnalogAttachSidebarProvider["collectInfo"]> = {
            sshConfig: config.get<string>("sshConfig"),
            sshpass: config.get<string>("sshpassConfig"),
            remoteHost: config.get<string>("remoteHost"),
            remoteUser: config.get<string>("remoteUser"),
            remotePassword: config.get<string>("remotePassword"),
        };

        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab?.input instanceof vscode.TabInputCustom) {
            const { uri } = activeTab.input;
            if (uri.fsPath.endsWith(".dtso")) {
                result.isDtsoFile = true;
                const session = AttachSessionManager.getInstance(this.context).getSession(uri);
                const basePath = session?.get_base_device_tree_path();
                if (basePath) {
                    result.mergedBaseDtsPath = path.basename(basePath);
                    result.mergedBaseDtsFullPath = basePath;
                }
            }
        }

        return result;
    }

    private postRefresh(): void {
        if (!this.view) {
            return;
        }

        this.view.webview.postMessage({
            id: `${EventCommands.fileChanged}-${Date.now()}`,
            type: "notification",
            timestamp: new Date().toISOString(),
            command: "analogAttach:sidebarRefresh",
            payload: this.collectInfo()
        });
    }

    private async handleSettingUpdate(key: string, value: unknown, _webview: vscode.Webview): Promise<void> {
        if (!["remoteHost", "remoteUser", "remotePassword"].includes(key)) {
            return;
        }

        const config = vscode.workspace.getConfiguration("analog-attach");
        await config.update(key, value, vscode.ConfigurationTarget.Global);

        const host = (key === "remoteHost" ? value : config.get<string>("remoteHost")) ?? "";
        const user = (key === "remoteUser" ? value : config.get<string>("remoteUser")) ?? "";
        const pass = (key === "remotePassword" ? value : config.get<string>("remotePassword")) ?? "";

        const sshConfig = user && host
            ? `ssh -o StrictHostKeyChecking=no ${user}@${host} '{command}'`
            : config.get<string>("sshConfig");
        const sshpassConfig = pass ? `sshpass -p ${pass}` : config.get<string>("sshpassConfig");

        if (sshConfig) {
            await config.update("sshConfig", sshConfig, vscode.ConfigurationTarget.Global);
        }
        if (sshpassConfig) {
            await config.update("sshpassConfig", sshpassConfig, vscode.ConfigurationTarget.Global);
        }

        this.postRefresh();
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = Math.random().toString(36).slice(2, 11);

        const csp = `default-src 'none'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';`;
        const initialInfo = this.collectInfo();

        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { color-scheme: var(--vscode-colorScheme); }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: transparent;
      padding: 12px;
    }
    h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
    .section { margin-bottom: 12px; }
    .field { margin: 4px 0; font-size: 12px; }
    .input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      margin: 4px 0 8px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: 12px;
    }
    button {
      width: 100%;
      margin: 4px 0;
      padding: 6px 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .small { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .info-icon { cursor: default; opacity: 0.7; margin-left: 4px; font-size: 16px; }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      color: var(--vscode-foreground);
    }
  </style>
</head>
<body>
  <div class="section">
    <h2>Commands</h2>
    <button data-cmd="merge" title="Selects a DTS to be the parent of the DTSO. DTSO nodes can then be attached to DTS nodes, and DTS phandles used by the DTSO nodes.">Merge DTS into DTSO</button>
    <button data-cmd="compile">Compile Device Tree</button>
    <button data-cmd="deploy">Deploy Device Tree</button>
    <button data-cmd="openSettings">Open Settings</button>
    <button data-cmd="toggleView">Switch View</button>
  </div>
  <div class="section" id="merge-info" style="display:none">
    <h2>Merge Info</h2>
    <div class="field">
      <strong>Base DTS:</strong>
      <span id="merge-base-path">&mdash;</span>
      <span class="info-icon" title="To change the merged base DTS file, use the 'Merge DTS into DTSO' button above.">&#9432;</span>
    </div>
  </div>
  <div class="section">
    <h2>Remote Settings</h2>
    <label class="field"><strong>IP Address:</strong>
      <input class="input" id="input-host" value="${initialInfo.remoteHost}" placeholder="e.g. 10.87.54.71" />
    </label>
    <label class="field"><strong>User:</strong>
      <input class="input" id="input-user" value="${initialInfo.remoteUser}" placeholder="e.g. root" />
    </label>
    <label class="field"><strong>Password:</strong>
      <input class="input" id="input-pass" value="${initialInfo.remotePassword}" placeholder="password" />
    </label>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: btn.dataset.cmd });
      });
    });

    // Refresh context on focus/visibility
    const refresh = () => vscode.postMessage({ command: "refresh" });
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });

    function updateMergeInfo(payload) {
      const section = document.getElementById('merge-info');
      const basePath = document.getElementById('merge-base-path');
      if (payload.isDtsoFile) {
        section.style.display = '';
        basePath.textContent = payload.mergedBaseDtsFullPath || 'No base DTS merged';
        basePath.title = payload.mergedBaseDtsFullPath || '';
      } else {
        section.style.display = 'none';
      }
    }

    updateMergeInfo(${JSON.stringify({ isDtsoFile: initialInfo.isDtsoFile, mergedBaseDtsPath: initialInfo.mergedBaseDtsPath, mergedBaseDtsFullPath: initialInfo.mergedBaseDtsFullPath })});

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg?.command === "analogAttach:sidebarRefresh" && msg?.payload) {
        const { remoteHost, remoteUser, remotePassword } = msg.payload;
        document.getElementById('input-host').value = remoteHost || "";
        document.getElementById('input-user').value = remoteUser || "";
        document.getElementById('input-pass').value = remotePassword || "";
        updateMergeInfo(msg.payload);
      }
    });

    const debounce = (fn, delay) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; };
    const updateSetting = debounce((key, value) => vscode.postMessage({ command: "updateSetting", key, value }), 300);

    document.getElementById('input-host').addEventListener('input', (e) => updateSetting('remoteHost', e.target.value));
    document.getElementById('input-user').addEventListener('input', (e) => updateSetting('remoteUser', e.target.value));
    document.getElementById('input-pass').addEventListener('input', (e) => updateSetting('remotePassword', e.target.value));
  </script>
</body>
</html>`;
    }

    private async toggleActiveView(): Promise<void> {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!(activeTab?.input instanceof vscode.TabInputCustom)) {
            vscode.window.showInformationMessage("Open a DTS/DTSO custom editor to switch views.");
            return;
        }

        const { viewType, uri } = activeTab.input;
        if (viewType !== "analog-attach.dtsEditor" && viewType !== "analog-attach.dtsPlugAndPlayEditor") {
            vscode.window.showInformationMessage("Active tab is not an Analog Attach custom editor.");
            return;
        }

        const nextView = viewType === "analog-attach.dtsEditor"
            ? "analog-attach.dtsPlugAndPlayEditor"
            : "analog-attach.dtsEditor";
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        if (activeTab) {
            await vscode.window.tabGroups.close(activeTab, true);
        }
        await vscode.commands.executeCommand("vscode.openWith", uri, nextView, {
            viewColumn: activeGroup.viewColumn,
            preview: false,
        });
    }
}

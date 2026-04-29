# Analog Attach

A Visual Studio Code extension for editing Device Tree Source (DTS) and Device
Tree Overlay (DTSO) files with schema validation, binding support, and remote
deployment capabilities.

## Features

### Dual Editor Approach

- **Plug and Play Editor** (default for `.dtso`): Intuitive, guided experience
  for quick device integration with a three-panel interface
- **Tree Config Editor** (default for `.dts`): Full tree visualization for
  advanced device tree modifications

### Comprehensive Device Support

- **Device Catalog**: Searchable list of supported devices grouped by category
- **Smart Configuration**: Dynamic property panels with real-time validation
- **Binding Compliance**: Automatic validation against Linux kernel device tree
  binding specifications
- **Channel Support**: Add and configure device channels with regex-validated naming

### Complete Workflow Integration

- **Local Compilation**: Built-in device tree compilation using `dtc`
- **Remote Deployment**: SSH-based deployment to target hardware
- **Auto-merge**: Automatically remembers and re-merges DTS bases for DTSO overlays

## Requirements

Analog Attach requires a valid Linux kernel repository to be configured before
use.

For full functionality, install the following packages:

```bash
sudo apt install gcc                    # C preprocessor for DTS includes
sudo apt install device-tree-compiler   # dtc compiler
sudo apt install ssh                    # Remote connections
sudo apt install sshpass                # Password-based SSH for deployment
```

## Installation

### From Marketplace

See [Analog Attach Extension](https://marketplace.visualstudio.com/items?itemName=AnalogDevices.analog-attach)

### From VSIX

1. Download the `.vsix` file from the project releases
2. In VS Code, open Command Palette (`Ctrl+Shift+P`)
3. Run **Extensions: Install from VSIX**
4. Select the downloaded file

### From Source

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions.

## Configuration

### Initial Setup

Before using the extension, configure the path to your Linux kernel repository:

1. Open VS Code Settings (`Ctrl+,`)
2. Search for "Analog Attach"
3. Set **Default Linux Repository** to your Linux kernel source path
   (e.g., `~/linux` or `~/analogdevicesinc/linux`)

### Available Settings

| Setting | Description |
|---------|-------------|
| `defaultLinuxRepository` | Path to the Linux kernel repository (required) |
| `defaultDtSchemaRepository` | Path to dt-schema repository (optional, uses bundled version if not set) |
| `enableAutoMergeDtsoBase` | Automatically merge DTSO with last selected DTS base |
| `preprocessDtsFilesCommand` | Command for preprocessing DTS files with includes |
| `compileDtsFileCommand` | Command for compiling DTS/DTSO files |
| `remoteHost` | Target device IP address for deployment |
| `remoteUser` | SSH username for target device |
| `remotePassword` | SSH password for target device |

## Usage

### Opening Files

- `.dtso` files open in **Plug and Play** editor by default
- `.dts` files open in **Tree Config** editor by default

To switch editors:
- Right-click the file tab and select **Reopen Editor With...**
- Or use the Analog Attach side panel and click **Switch View**

### Plug and Play Editor

Best for creating new overlays and quick device integration.

1. **Merge a DTS base**: Run `Analog Attach: Add Device Tree file to current overlay`
   (`Ctrl+Shift+P`) to provide context for parent suggestions
2. **Add devices**: Use the left panel to search and add devices from the catalog
3. **Select parent**: Choose a valid parent node for the device
4. **Configure**: Use the right panel to set properties and add channels
5. **Save**: Changes are automatically saved to the `.dtso` file

### Tree Config Editor

For users requiring maximum flexibility and control.

1. **Navigate**: Click nodes in the tree to view their configuration
2. **Add nodes**: Use the **+** button to add devices or custom nodes
3. **Configure**: Edit properties in the main panel
4. **Search**: Use the search bar to find nodes by path
5. **Go to references**: Use the hyperlink button to navigate to referenced nodes

### Commands

Access via Command Palette (`Ctrl+Shift+P`):

- **Analog Attach: Add Device Tree file to current overlay** - Merge a DTS base into the current DTSO
- **Analog Attach: Compile Device Tree** - Compile the current file to DTB/DTBO
- **Analog Attach: Deploy Device Tree** - Deploy compiled binary to target via SSH

### Sidebar

The Analog Attach side panel (click the AA icon in the activity bar) provides:

- Quick access to merge, compile, and deploy commands
- Remote settings editor (IP, user, password)
- View switcher between editors
- Settings shortcut

## Troubleshooting

Analog Attach writes logs to `analog-attach.log` in the VS Code extension log
directory. The path is printed in the **Extension Host** output at startup.

For issues and bug reports, see
[GitHub Issues](https://github.com/analogdevicesinc/analog-attach/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

See [LICENSE](LICENSE.txt) for details.

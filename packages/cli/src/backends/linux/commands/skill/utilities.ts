import path from 'node:path';

// The Linux backend's bundled files, under its `assets_directory` (`<package root>/bundled/linux`),
// as scripts/bundle-dt-schema.sh writes them.

export function getBundledDtSchemaPath(assets_directory: string): string {
    return path.join(assets_directory, 'dt-schema');
}

export function getBundledToolsPath(assets_directory: string): string {
    return path.join(assets_directory, 'tools');
}

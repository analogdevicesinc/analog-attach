import * as os from 'node:os';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import path from 'node:path';
import { Attach, extract_compatible } from 'attach-lib';

export type CompatibleMapping = {
    compatible_string: string;
    binding_path: string;
};

export function write_compatible_mappings_to_file(
    file_path: string,
    mappings: CompatibleMapping[]
): void {
    const lines = mappings.map(
        (mapping) => `${mapping.compatible_string} - ${mapping.binding_path}`
    );
    fs.writeFileSync(file_path, lines.join('\n'), 'utf8');
}

export function read_compatible_mappings_from_file(
    file_path: string
): CompatibleMapping[] {
    const content = fs.readFileSync(file_path, 'utf8');
    return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
            const [compatible_string, binding_path] = line.split(' - ');
            return { compatible_string, binding_path };
        });
}

export function expand_tilde_if_present(tilde_path: string): string {

    if (tilde_path.startsWith('~')) {
        return tilde_path.replace('~', os.homedir());
    }

    return tilde_path;
}

export function get_circular_replacer(): (this: any, key: string, value: any) => any {
    const ancestors: any[] = [];
    return function (_key: any, value: null) {
        if (typeof value !== "object" || value === null) {
            return value;
        }
        // `this` is the object that value is contained in,
        // i.e., its direct parent.
        while (ancestors.length > 0 && ancestors.at(-1) !== this) {
            ancestors.pop();
        }
        if (ancestors.includes(value)) {
            return "[Circular]";
        }
        ancestors.push(value);
        return value;
    };
}

export function get_directory_md5_sync(directory: string): string {
    const filePaths = get_all_file_paths(directory);
    const hash = crypto.createHash('md5');

    for (const filePath of filePaths) {
        const relativePath = path.relative(directory, filePath);
        const fileContent = fs.readFileSync(filePath);

        // Include file path and content to account for renames/moves
        hash.update(relativePath);
        hash.update(fileContent);
    }

    return hash.digest('hex');
}

export function get_all_file_paths(directory: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(directory);

    for (const file of list) {
        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = [...results, ...get_all_file_paths(filePath)];
        } else {
            results.push(filePath);
        }
    }

    return results.sort(); // Sort to make hash order-independent
}

export type ProgressCallback = (message: string, increment?: number) => void;

export async function get_compatible_mapping(
    bindings_folder: string,
    linux_path: string,
    dt_schema_path: string,
    onProgress?: ProgressCallback
): Promise<CompatibleMapping[]> {

    const all_files = get_all_file_paths(bindings_folder);
    const yaml_files = all_files.filter(file => file.endsWith(".yaml"));
    const total_files = yaml_files.length;
    const compatible_mapping: CompatibleMapping[] = [];

    for (const [index, file] of yaml_files.entries()) {

        if (onProgress) {
            onProgress(`Indexing bindings (${index + 1}/${total_files})`);
            // Yield every 10 files to allow progress UI to update
            if (index % 10 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        const attach = Attach.new();
        //TODO Do we really care about having this dereferenced?
        const binding = await attach.parse_binding(file, linux_path, dt_schema_path);

        if (binding === undefined) {
            continue;
        }

        const compatible = extract_compatible(binding.parsed_binding);

        if (compatible === undefined) {
            continue;
        }

        for (const entry of compatible) {
            compatible_mapping.push({
                compatible_string: entry,
                binding_path: file
            });
        }

    }

    return compatible_mapping;
}

export function bigIntReplacer(_key: string, value: any): any {
    return typeof value === 'bigint' ? value.toString() : value;
}

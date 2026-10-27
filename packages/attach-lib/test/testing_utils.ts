import * as fs from 'node:fs';
import path from 'node:path';

export function ensure_directory(directory_path: string) {
    if (!fs.existsSync(directory_path)) {
        fs.mkdirSync(directory_path, { recursive: true });
    }
}

function bigint_replacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? Number(value) : value;
}

export function write_to_directory(directory_path: string, file_name: string, content: unknown) {
    ensure_directory(directory_path);
    fs.writeFileSync(path.join(directory_path, `${file_name}.json`), JSON.stringify(content, bigint_replacer, 4));
}

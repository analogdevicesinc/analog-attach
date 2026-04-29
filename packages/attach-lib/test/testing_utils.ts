/* eslint-disable unicorn/prevent-abbreviations */
import * as fs from 'node:fs';
import path from 'node:path';

export type BindingTestData = {
    path: string,
    name: string,
    debug: boolean
}

export function ensure_directory(directory_path: string) {
    if (!fs.existsSync(directory_path)) {
        fs.mkdirSync(directory_path, { recursive: true });
    }
}

export function clean_directory(directory_path: string) {
    if (fs.existsSync(directory_path)) {
        fs.rmdirSync(directory_path, { recursive: true });
    }
}

export function bigIntReplacer(_key: string, value: any): any {
    return typeof value === 'bigint' ? value.toString() : value;
}

export function write_to_directory(directory_path: string, file_name: string, content: any) {
    ensure_directory(directory_path);
    fs.writeFileSync(path.join(directory_path, `${file_name}.json`), JSON.stringify(content, bigIntReplacer, 4));
}

export function write_auto_increment_array_to_directory(directory_path: string, file_name: string, content_array: any[]) {
    if (!Array.isArray(content_array)) {
        throw new TypeError("Not array!");
    }

    let index = 0;

    for (const item of content_array) {
        write_to_directory(directory_path, `${file_name}_${index}`, item);
        index++;
    }
}

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const test_dir = resolve(dirname(fileURLToPath(import.meta.url)), 'test');
const linux_path = resolve(test_dir, 'linux');
const dt_schema_path = resolve(test_dir, 'dt-schema');

const LINUX_REMOTE = 'https://github.com/analogdevicesinc/linux';
const LINUX_COMMIT = '3a020df09ceee7cbeb1c3adce2cdc86d2af61353';
const DT_SCHEMA_REMOTE = 'https://github.com/devicetree-org/dt-schema';

function head_commit(repo: string): string | undefined {
    try {
        return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return;
    }
}

export async function setup() {
    if (head_commit(linux_path) !== LINUX_COMMIT) {
        if (existsSync(linux_path)) { rmSync(linux_path, { recursive: true }); }
        console.log('[setup] cloning linux...');
        execFileSync('git', ['init', linux_path]);
        execFileSync('git', ['-C', linux_path, 'remote', 'add', 'origin', LINUX_REMOTE]);
        execFileSync('git', ['-C', linux_path, 'fetch', '--depth', '1', 'origin', LINUX_COMMIT], { stdio: 'inherit' });
        execFileSync('git', ['-C', linux_path, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit' });
    }

    if (!existsSync(dt_schema_path)) {
        console.log('[setup] cloning dt-schema...');
        execFileSync('git', ['clone', '--depth', '1', '-b', 'main', DT_SCHEMA_REMOTE, dt_schema_path], { stdio: 'inherit' });
    }
}

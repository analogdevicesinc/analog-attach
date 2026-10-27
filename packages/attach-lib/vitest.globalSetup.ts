import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const package_dir = dirname(fileURLToPath(import.meta.url));
const test_dir = resolve(package_dir, 'test');
const linux_path = resolve(test_dir, 'linux');
const dt_schema_path = resolve(test_dir, 'dt-schema');

const LINUX_REMOTE = 'https://github.com/analogdevicesinc/linux';
const LINUX_COMMIT = '3a020df09ceee7cbeb1c3adce2cdc86d2af61353';
const DT_SCHEMA_REMOTE = 'https://github.com/devicetree-org/dt-schema';

/** The dt-schema the CLI bundles (`DTSCHEMA_COMMIT` in its bundle script): the tests resolve bindings against the same. */
function bundled_dt_schema_commit(): string {
    const script = readFileSync(resolve(package_dir, '../attach-cli/scripts/bundle-dt-schema.sh'), 'utf8');
    const commit = /^DTSCHEMA_COMMIT="([\da-f]{40})"$/m.exec(script)?.[1];
    if (commit === undefined) { throw new Error('no DTSCHEMA_COMMIT in attach-cli/scripts/bundle-dt-schema.sh'); }
    return commit;
}

/** A shallow checkout of `remote` at `commit` in `directory`, replacing what is there. */
function checkout(directory: string, remote: string, commit: string) {
    if (existsSync(directory)) { rmSync(directory, { recursive: true }); }
    execFileSync('git', ['init', directory]);
    execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', remote]);
    execFileSync('git', ['-C', directory, 'fetch', '--depth', '1', 'origin', commit], { stdio: 'inherit' });
    execFileSync('git', ['-C', directory, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit' });
}

function head_commit(repo: string): string | undefined {
    try {
        return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
        return;
    }
}

export async function setup() {
    if (head_commit(linux_path) !== LINUX_COMMIT) {
        console.log('[setup] cloning linux...');
        checkout(linux_path, LINUX_REMOTE, LINUX_COMMIT);
    }

    const dt_schema_commit = bundled_dt_schema_commit();
    if (head_commit(dt_schema_path) !== dt_schema_commit) {
        console.log(`[setup] cloning dt-schema at ${dt_schema_commit}...`);
        checkout(dt_schema_path, DT_SCHEMA_REMOTE, dt_schema_commit);
    }
}

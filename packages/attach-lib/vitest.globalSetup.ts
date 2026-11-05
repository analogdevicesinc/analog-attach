import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const package_dir = dirname(fileURLToPath(import.meta.url));
const test_dir = resolve(package_dir, 'test');
const linux_path = resolve(test_dir, 'linux');
const dt_schema_path = resolve(test_dir, 'dt-schema');
const bindings_path = resolve(linux_path, 'Documentation/devicetree/bindings');
// test/bindings.ts's schema_paths.processed_schema
const processed_schema_path = resolve(bindings_path, 'processed-schema.json');
const processed_schema_stamp = resolve(bindings_path, 'processed-schema.stamp');
const cli_tools = resolve(package_dir, '../cli/bundled/linux/tools');

const LINUX_REMOTE = 'https://github.com/analogdevicesinc/linux';
const LINUX_COMMIT = '3a020df09ceee7cbeb1c3adce2cdc86d2af61353';
const DT_SCHEMA_REMOTE = 'https://github.com/devicetree-org/dt-schema';

/** The dt-schema the CLI bundles (`DTSCHEMA_COMMIT` in its bundle script): the tests resolve bindings against the same. */
function bundled_dt_schema_commit(): string {
    const script = readFileSync(resolve(package_dir, '../cli/scripts/bundle-dt-schema.sh'), 'utf8');
    const commit = /^DTSCHEMA_COMMIT="([\da-f]{40})"$/m.exec(script)?.[1];
    if (commit === undefined) { throw new Error('no DTSCHEMA_COMMIT in cli/scripts/bundle-dt-schema.sh'); }
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

/**
 * The processed schema of the Linux tree (`dt-mk-schema -j`), built with the CLI's bundled tool, as the CLI builds its
 * `validation.json`: again when the tool (its `.recipe`) or the Linux commit changed.
 */
function ensure_processed_schema() {
    const tool = resolve(cli_tools, 'dt-mk-schema');
    if (!existsSync(tool)) {
        throw new Error(`no ${tool}: build the CLI's dt-schema tools first (packages/cli/scripts/bundle-dt-schema.sh)`);
    }
    const stamp = `${LINUX_COMMIT} ${readFileSync(resolve(cli_tools, '.recipe'), 'utf8').trim()}`;
    if (existsSync(processed_schema_path) && existsSync(processed_schema_stamp) && readFileSync(processed_schema_stamp, 'utf8') === stamp) { return; }

    console.log('[setup] building the processed schema of the Linux tree...');
    execFileSync(tool, ['-j', '-o', processed_schema_path, bindings_path], { stdio: 'inherit' });
    writeFileSync(processed_schema_stamp, stamp);
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

    ensure_processed_schema();
}

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

const LINUX_REMOTE = 'https://github.com/analogdevicesinc/linux';
const LINUX_COMMIT = '3a020df09ceee7cbeb1c3adce2cdc86d2af61353';
const DT_SCHEMA_REMOTE = 'https://github.com/devicetree-org/dt-schema';
// The dt-schema the CLI takes (DT_SCHEMA_VERSION in cli/src/backends/linux/config/tools.ts), and its release tag's
// commit (v2026.09): the tests resolve bindings against the same. Keep them in step with the CLI's.
const DT_SCHEMA_VERSION = '2026.9';
const DT_SCHEMA_COMMIT = '01b5073abbeb732a04c22f01ac0370b951b20c0e';

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

/** `dt-mk-schema --version`, or undefined when it isn't on PATH. */
function dt_mk_schema_version(): string | undefined {
    try {
        return execFileSync('dt-mk-schema', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return;
    }
}

/**
 * The processed schema of the Linux tree (`dt-mk-schema -j`), built with the dt-mk-schema on PATH, as the CLI builds its
 * `validation.json`: again when its version or the Linux commit changed.
 */
function ensure_processed_schema() {
    const version = dt_mk_schema_version();
    const install = `'pipx install --force dtschema==${DT_SCHEMA_VERSION}', then 'pipx inject dtschema ruamel.yaml.clib'`;
    if (version === undefined) { throw new Error(`dt-mk-schema not found on PATH: install dt-schema ${DT_SCHEMA_VERSION} (${install})`); }
    if (version !== DT_SCHEMA_VERSION) { throw new Error(`dt-schema ${version} is installed; the tests need ${DT_SCHEMA_VERSION} (${install})`); }
    const stamp = `${LINUX_COMMIT} dt-schema ${version}`;
    if (existsSync(processed_schema_path) && existsSync(processed_schema_stamp) && readFileSync(processed_schema_stamp, 'utf8') === stamp) { return; }

    console.log('[setup] building the processed schema of the Linux tree...');
    execFileSync('dt-mk-schema', ['-j', '-o', processed_schema_path, bindings_path], { stdio: 'inherit' });
    writeFileSync(processed_schema_stamp, stamp);
}

export async function setup() {
    if (head_commit(linux_path) !== LINUX_COMMIT) {
        console.log('[setup] cloning linux...');
        checkout(linux_path, LINUX_REMOTE, LINUX_COMMIT);
    }

    if (head_commit(dt_schema_path) !== DT_SCHEMA_COMMIT) {
        console.log(`[setup] cloning dt-schema at ${DT_SCHEMA_COMMIT}...`);
        checkout(dt_schema_path, DT_SCHEMA_REMOTE, DT_SCHEMA_COMMIT);
    }

    ensure_processed_schema();
}

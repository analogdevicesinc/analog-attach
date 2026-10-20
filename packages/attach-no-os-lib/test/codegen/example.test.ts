import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap, pin_driver } from '../../src/bootstrap/bootstrap';
import { example_blocks } from '../../src/codegen/codegen_helpers';
import { generate_project } from '../../src/codegen/codegen';
import { find_board } from '../../src/registry/platforms';
import { read_ruleset_index } from '../../src/registry/module_yml';
import { driver_root_for } from '../../src/registry/roots';
import { get_registry } from '../../src/registry/registry';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { add_symbol, create_workfile } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import {
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_ADC_DRIVERS,
    FIXTURE_BOARD,
    FIXTURE_CAPI,
    FIXTURE_DRIVERS,
    FIXTURE_PLATFORM,
    FIXTURE_SOC,
} from '../test_utilities';

// A driver's `example:` (its ruleset index): code the generated main.c runs once everything
// is up, so the part is seen working. `loop` is required, `setup` is not. testpart has only a
// loop; dualpart has both, and renders something only for the handles it has something on.

function board_workfile(): Workfile {
    const created = create_workfile(FIXTURE_SOC);
    expectOk(created);
    created.value.board = FIXTURE_BOARD;
    return created.value;
}

function add(workfile: Workfile, name: string, symbol: string): void {
    const ruleset = load_resolved_ruleset(symbol);
    expectOk(ruleset);
    expectOk(add_symbol(workfile, name, ruleset.value));
}

describe('example: in a ruleset index', () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-example-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    function index(example: string): string {
        const file = path.join(directory, 'module.yml');
        fs.writeFileSync(file, `schema_version: "1.0"\nrulesets: {}\n${example}`);
        return file;
    }

    test('loop alone is an example; setup is optional', () => {
        const read = read_ruleset_index(index('example:\n  loop: loop.eta\n'));
        expectOk(read);
        expect(read.value.example).toEqual({ loop: 'loop.eta' });
    });

    test('an example with no loop is refused', () => {
        expectErrorContains(read_ruleset_index(index('example:\n  setup: setup.eta\n')), 'loop');
    });

    test('the registry resolves the files beside the index, and refuses a missing one', () => {
        setup_test_config();
        try {
            const registry = get_registry();
            expectOk(registry);
            const testpart = registry.value.modules.find(module => module.name === 'testpart');
            expect(testpart?.example?.loop).toBe(path.join(FIXTURE_DRIVERS, 'drivers/sensor/testpart/analog-attach/examples/loop.eta'));
            expect(testpart?.example?.setup).toBeUndefined();
        } finally {
            teardown_test_config();
        }
    });
});

describe('the example blocks main.c gets', () => {
    afterEach(() => { teardown_test_config(); });

    test('one per handle of the driver, rendered with its name and type', () => {
        setup_test_config();
        const workfile = board_workfile();
        add(workfile, 'sensor', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'sensor'));
        expectOk(bootstrap(workfile));
        expect(example_blocks(workfile)).toEqual([
            { handle: 'sensor', driver: 'testpart', loop: 'printf("sensor is a test_sensor\\n");' },
        ]);
    });

    test('a handle the template renders nothing for is skipped, and a setup-only one kept', () => {
        setup_test_config({ modules: [FIXTURE_PLATFORM, FIXTURE_DRIVERS, FIXTURE_ADC_DRIVERS] });
        const workfile = board_workfile();
        for (const interface_ of ['test_adc', 'test_dac']) {
            const root = driver_root_for('dualpart', interface_);
            expectOk(root);
            add(workfile, interface_, root.value);
            expectOk(pin_driver(workfile, interface_, 'dualpart', interface_ === 'test_dac' ? 'dualpart_init_param' : undefined));
        }
        expectOk(bootstrap(workfile));
        add(workfile, 'ch0', 'test_adc_chan');
        expectOk(bootstrap(workfile));

        expect(example_blocks(workfile)).toEqual([
            { handle: 'test_dac', driver: 'dualpart', setup: 'set_dac(test_dac);', loop: '' },
            { handle: 'ch0', driver: 'dualpart', loop: 'read_channel(ch0);' },
        ]);
    });
});

describe('main.c without a console', () => {
    let output: string;
    beforeEach(() => {
        setup_test_config();
        output = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-example-'));
    });
    afterEach(() => {
        teardown_test_config();
        fs.rmSync(output, { recursive: true, force: true });
    });

    test('runs the app: an example prints, and this board has nowhere to print to', () => {
        const workfile = board_workfile();
        add(workfile, 'sensor', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'sensor'));
        expectOk(bootstrap(workfile));
        const board = find_board(FIXTURE_BOARD);
        expectOk(board);
        expectOk(generate_project({
            workfile, platform_name: FIXTURE_SOC, platform_vendor: 'testvendor', board: board.value,
            project_name: 'p', project_path: path.join(output, 'p'), capi_path: FIXTURE_CAPI, template_set: 'capi',
        }));
        const main = fs.readFileSync(path.join(output, 'p', 'src', 'main.c'), 'utf8');
        expect(main).toContain('return app_main();');
        expect(main).not.toContain('example_main');
        expect(fs.readFileSync(path.join(output, 'p', 'src', 'app.c'), 'utf8')).toContain('int app_main(void)');
    });
});

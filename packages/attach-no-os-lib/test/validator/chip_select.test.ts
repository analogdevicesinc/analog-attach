import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap } from '../../src/bootstrap/bootstrap';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { validate_workfile } from '../../src/validator/validator';
import { add_symbol, create_workfile, set_value } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { expectOk, setup_test_config, teardown_test_config, FIXTURE_SOC } from '../test_utilities';

// Two SPI devices on one chip-select line would both answer every transfer. Bootstrap never
// hands out a taken line, so these are built the way a user would get there: by hand.

function two_sensors(board: string, soc: string): Workfile {
    const created = create_workfile(soc);
    expectOk(created);
    const workfile = created.value;
    workfile.board = board;
    for (const name of ['first', 'second']) {
        const ruleset = load_resolved_ruleset('test_sensor');
        expectOk(ruleset);
        expectOk(add_symbol(workfile, name, ruleset.value));
        expectOk(attach_eval_board(workfile, 'eval-testpart', name));
    }
    expectOk(bootstrap(workfile));
    return workfile;
}

function chip_select_errors(workfile: Workfile): string[] {
    return validate_workfile(workfile).errors
        .filter(error => error.message.includes('both would be selected'))
        .map(error => error.path ?? '');
}

describe('shared chip-selects', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('two devices on the same GPIO chip-select are both flagged', () => {
        const workfile = two_sensors('otherboard', 'othersoc');
        expect(chip_select_errors(workfile)).toEqual([]);

        // The second device was left without one; point it at the first device's pin.
        expectOk(set_value(workfile, 'second_spi_dev', 'cs_gpio', 'first_cs_gpio'));
        expectOk(set_value(workfile, 'second_spi_dev', 'cs_gpio_num', 1));
        expect(chip_select_errors(workfile).sort()).toEqual(['first_spi_dev.cs_gpio', 'second_spi_dev.cs_gpio']);
    });

    test('two devices on the same native line of one controller are both flagged', () => {
        const workfile = two_sensors('testboard', FIXTURE_SOC);
        expectOk(set_value(workfile, 'second_spi_dev', 'native_cs', 1));
        expect(chip_select_errors(workfile).sort()).toEqual(['first_spi_dev.native_cs', 'second_spi_dev.native_cs']);
    });

    test('different native lines on one controller are fine', () => {
        const workfile = two_sensors('testboard', FIXTURE_SOC);
        expectOk(set_value(workfile, 'second_spi_dev', 'native_cs', 2));
        expect(chip_select_errors(workfile)).toEqual([]);
    });
});

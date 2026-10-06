import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
    create_workfile,
    add_symbol,
    set_value,
    export_minimal,
    import_minimal,
    list_available_structs,
    suggest_for_property,
    materialize_referenced_hidden,
} from '../../src/workfile_handler/workfile_handler';
import { validate_workfile } from '../../src/validator/validator';
import { load_resolved_ruleset_for_board } from '../../src/resolver/resolver';
import { soc_for_board, resolve_board } from '../../src/registry/platforms';
import {
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_BOARD,
    FIXTURE_SOC,
} from '../test_utilities';

// Bringing a part up end to end, the way the layers actually compose:
//
//   a board peripheral (extern)  ->  a controller descriptor's $init_param
//   a controller                 ->  the bus device that sits on it
//   the bus device               ->  the driver's init_param, through a union member
//   the driver's init_param      ->  constrains the bus device from above ($override)
//
// Every reference is a bare symbol, resolved through the registry across three separate
// module roots, and the whole thing has to survive being written out and read back.

const BOARD_CFG = 'bsp_test_spi_cfg';

// How the part is selected. `native` is what the wiring resolver picks on the fixture board
// (its PMOD port mates, and PMOD pin 1 is native chip-select 0); the rest are what the
// part's `$any_of` has to tell apart.
type ChipSelectChoice = 'native' | 'gpio' | 'both' | 'none' | 'native_zero';

function build(chip_select: ChipSelectChoice = 'native') {
    const workfile = create_workfile(FIXTURE_SOC);
    expectOk(workfile);
    workfile.value.board = FIXTURE_BOARD;

    const nodes: [string, string][] = [
        ['spi_cfg', BOARD_CFG],
        ['spi_ctrl', 'test_spi_controller'],
        ['part_spi_dev', 'test_spi_device'],
        ['part_ip', 'testpart_init_param'],
    ];
    if (chip_select === 'gpio' || chip_select === 'both') {
        nodes.push(['part_cs', 'test_gpio_pin']);
    }

    for (const [name, type] of nodes) {
        const ruleset = load_resolved_ruleset_for_board(type, FIXTURE_BOARD);
        expectOk(ruleset);
        expectOk(add_symbol(workfile.value, name, ruleset.value));
    }

    const values: [string, string, unknown][] = [
        ['spi_ctrl', '$init_param', 'spi_cfg'],
        ['part_spi_dev', 'controller', 'spi_ctrl'],
        ['part_spi_dev', 'max_speed_hz', 1000000],
        ['part_ip', 'comm_type', 'TESTPART_SPI'],
        ['part_ip', 'comm_init', { spi_dev: 'part_spi_dev' }],
    ];
    if (chip_select === 'native' || chip_select === 'both') {
        values.push(['part_spi_dev', 'native_cs', 0x1]);
    }
    if (chip_select === 'native_zero') {
        values.push(['part_spi_dev', 'native_cs', 0]);
    }
    if (chip_select === 'gpio' || chip_select === 'both') {
        values.push(
            ['part_cs', 'number', 4],
            // A hidden handle, named by the port config it wraps; materialized below.
            ['part_cs', 'port_handle', 'bsp_test_gpio0_cfg_handle'],
            ['part_spi_dev', 'cs_gpio', 'part_cs'],
            ['part_spi_dev', 'cs_gpio_num', 1],
        );
    }
    for (const [symbol, property, value] of values) {
        expectOk(set_value(workfile.value, symbol, property, value));
    }
    expectOk(materialize_referenced_hidden(workfile.value));

    return workfile.value;
}

describe('the part asks to be selectable ($any_of)', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    function chip_select_errors(choice: ChipSelectChoice) {
        return validate_workfile(build(choice)).errors.filter(error => error.path?.startsWith('part_spi_dev'));
    }

    test('with no chip-select at all, it says what would satisfy it', () => {
        const errors = chip_select_errors('none');
        expect(errors.map(error => error.path)).toEqual(['part_spi_dev.native_cs', 'part_spi_dev.cs_gpio']);
        expect(errors[0]?.message).toBe('needs one of: cs_gpio, native_cs other than 0');
    });

    test('a native mask of 0 selects nothing, so it is still missing', () => {
        // 0 has a value, so native_cs passes its own required check and only cs_gpio is
        // reported - the error lands on the field that still needs something.
        const errors = chip_select_errors('native_zero');
        expect(errors.map(error => `${error.path ?? ''}: ${error.message}`)).toEqual([
            'part_spi_dev.cs_gpio: needs one of: cs_gpio, native_cs other than 0',
        ]);
    });

    test('a native chip-select satisfies it', () => {
        expect(chip_select_errors('native')).toEqual([]);
    });

    test('a GPIO chip-select satisfies it', () => {
        expect(chip_select_errors('gpio')).toEqual([]);
    });

    test('both is fine: it is a lower bound only', () => {
        expect(chip_select_errors('both')).toEqual([]);
    });
});

describe('a part brought up end to end', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('the board settles the chip, and the chip settles the board back', () => {
        const soc = soc_for_board(FIXTURE_BOARD);
        expectOk(soc);
        expect(soc.value).toBe(FIXTURE_SOC);

        const board = resolve_board(soc.value);
        expectOk(board);
        expect(board.value.name).toBe(FIXTURE_BOARD);
    });

    test('it validates', () => {
        const result = validate_workfile(build());
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    test('a board peripheral is assignable to a descriptor that includes its type', () => {
        // The extern is synthesized from board.yml and matches on $provides, which is how
        // bsp_test_spi_cfg lands on a controller whose $init_param includes test_spi_config.
        const workfile = build();
        const result = validate_workfile(workfile);
        expect(result.valid).toBe(true);
        expect(workfile.symbols['spi_cfg']._t).toBe('RulesetExtern');
    });

    test('the driver constrains the bus device from above', () => {
        // testpart_init_param caps max_speed_hz at 10 MHz through its union member, without
        // test_spi_device knowing a driver exists.
        const workfile = build();
        expectOk(set_value(workfile, 'part_spi_dev', 'max_speed_hz', 20000000));

        const result = validate_workfile(workfile);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.message.includes('above the maximum 10000000'))).toBe(true);
    });

    test('and locks the mode it needs', () => {
        const workfile = build();
        expectOk(set_value(workfile, 'part_spi_dev', 'mode', 'TEST_SPI_MODE_3'));

        const result = validate_workfile(workfile);
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.message.includes('TEST_SPI_MODE_3'))).toBe(true);
    });

    test('a value within the constraint is accepted', () => {
        const workfile = build();
        expectOk(set_value(workfile, 'part_spi_dev', 'mode', 'TEST_SPI_MODE_0'));
        expect(validate_workfile(workfile).valid).toBe(true);
    });

    test('the board offers its peripherals, and only its own', () => {
        const workfile = build();
        const available = list_available_structs(workfile);
        expectOk(available);

        expect(available.value.by_module[FIXTURE_BOARD]).toContain(BOARD_CFG);
        // The other board declares the same symbol; it is not in play here.
        expect(available.value.by_module['otherboard']).toBeUndefined();
    });

    test('a union suggests the member that fits', () => {
        const workfile = build();
        const suggestions = suggest_for_property(workfile, 'part_ip', 'comm_init', 'spi_dev');
        expectOk(suggestions);
        expect(suggestions.value.values).toContain('part_spi_dev');
    });

    test('it survives being written out and read back', () => {
        const workfile = build();

        const exported = export_minimal(workfile);
        expectOk(exported);
        expect(exported.value.board).toBe(FIXTURE_BOARD);
        // The board extern round-trips on its $compatible alone, having nothing to configure.
        expect(exported.value.symbols['spi_cfg']).toEqual({ $compatible: BOARD_CFG });

        const reimported = import_minimal(exported.value);
        expectOk(reimported);
        expect(validate_workfile(reimported.value).valid).toBe(true);

        const again = export_minimal(reimported.value);
        expectOk(again);
        expect(again.value).toEqual(exported.value);
    });
});

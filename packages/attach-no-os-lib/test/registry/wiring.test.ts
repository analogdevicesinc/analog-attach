import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { board_bus_pins, board_gpio_ports } from '../../src/registry/bsp';
import { find_board } from '../../src/registry/platforms';
import { describe_board_pin, find_eval_board, land, resolve_bus } from '../../src/registry/wiring';
import type { Wire } from '../../src/registry/wiring';
import type { BoardInfo, ModuleInfo } from '../../src/registry/types';
import {
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_BOARD,
} from '../test_utilities';

// How a part is wired to a board. Three files meet, each describing only itself: the eval
// board's pinout (which pin is CS), the board's pinout (which GPIO each header pin is) and
// the board's BSP (which header pins carry each bus). The fixture board has a PMOD port,
// so a PMOD eval board mates with it and needs nothing stated, plus a header of another
// standard where a stated wire can land instead.

function part(): ModuleInfo {
    const found = find_eval_board('testpart');
    expectOk(found);
    return found.value;
}

function wire(from: string, to: string): Wire {
    const [from_connector = '', from_pin = ''] = from.split('.');
    const [to_connector = '', to_pin = ''] = to.split('.');
    return { from: { connector: from_connector, pin: from_pin }, to: { connector: to_connector, pin: to_pin } };
}

describe('pinout and BSP data', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a pinout parses into connectors, pins, roles and GPIO identities', () => {
        const board = find_board(FIXTURE_BOARD);
        expectOk(board);

        const pmod = board.value.connectors.find(connector => connector.id === 'PMOD');
        expect(pmod?.type).toBe('pmod_12');
        // A header position is kept as text, so it compares the same as a chip pin name.
        expect(pmod?.pins[0]).toEqual({
            pin: '1',
            roles: ['gpio', 'spi_cs'],
            mnemonic: 'T0_4',
            gpio: { port: 'TEST_GPIO0', number: 4 },
        });
    });

    test('a single role reads the same as a list of one', () => {
        const board = find_board(FIXTURE_BOARD);
        expectOk(board);
        const header = board.value.connectors.find(connector => connector.id === 'H1');
        expect(header?.pins[2]?.roles).toEqual(['power']);
    });

    test('a bus says which header pins carry it, including its native chip-selects', () => {
        const buses = board_bus_pins(FIXTURE_BOARD);
        expectOk(buses);

        const spi = buses.value.find(bus => bus.peripheral === 'bsp_test_spi_cfg');
        expect(spi?.kind).toBe('spi');
        expect(spi?.signals).toContainEqual({ signal: 'sck', at: { connector: 'PMOD', pin: '4' } });
        expect(spi?.signals).toContainEqual({ signal: 'cs', at: { connector: 'PMOD', pin: '1' }, native_cs: 0 });
    });

    test('a bus that declares no pins: is left out, not listed empty', () => {
        // otherboard's SPI entry has no `pins:`, so there is nothing about it to join on.
        const buses = board_bus_pins('otherboard');
        expectOk(buses);
        expect(buses.value).toEqual([]);
    });

    test('chip ports map to the BSP port that drives them', () => {
        const ports = board_gpio_ports(FIXTURE_BOARD);
        expectOk(ports);
        expect(ports.value.get('TEST_GPIO0')).toBe('bsp_test_gpio0_cfg');
        expect(ports.value.get('TEST_GPIO1')).toBe('bsp_test_gpio1_cfg');
        expect(ports.value.has('TEST_GPIO3')).toBe(false);
    });

    test('describing a pin joins all three: identity, port extern, bus signals', () => {
        const pin = describe_board_pin(FIXTURE_BOARD, { connector: 'PMOD', pin: '1' });
        expectOk(pin);
        expect(pin.value.gpio).toEqual({ port: 'TEST_GPIO0', number: 4 });
        expect(pin.value.port_extern).toBe('bsp_test_gpio0_cfg');
        expect(pin.value.signals).toEqual([
            { peripheral: 'bsp_test_spi_cfg', kind: 'spi', signal: 'cs', native_cs: 0 },
        ]);
    });

    test('an unknown connector or pin is named in the error', () => {
        expectErrorContains(describe_board_pin(FIXTURE_BOARD, { connector: 'J99', pin: '1' }), "no connector 'J99'");
        expectErrorContains(describe_board_pin(FIXTURE_BOARD, { connector: 'PMOD', pin: '99' }), "has no pin '99'");
    });
});

describe('finding the eval board', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('by the part it implements', () => {
        expect(part().name).toBe('eval-testpart');
    });

    test('an unimplemented part says so', () => {
        expectErrorContains(find_eval_board('no_such_part'), "No eval board in the configured roots implements 'no_such_part'");
    });
});

describe('landing a pin', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    function board(): BoardInfo {
        const found = find_board(FIXTURE_BOARD);
        expectOk(found);
        return found.value;
    }

    test('two connectors of the same standard mate pin-for-pin', () => {
        expect(land(part(), board(), { connector: 'P1', pin: '4' }, [])).toEqual({
            kind: 'wired',
            to: { connector: 'PMOD', pin: '4' },
            via: 'mating',
        });
    });

    test('a stated wire wins over mating', () => {
        expect(land(part(), board(), { connector: 'P1', pin: '1' }, [wire('P1.1', 'H1.1')])).toEqual({
            kind: 'wired',
            to: { connector: 'H1', pin: '1' },
            via: 'wire',
        });
    });

    test('with no connector of the same standard, nothing is guessed', () => {
        const otherboard = find_board('otherboard');
        expectOk(otherboard);
        const landing = land(part(), otherboard.value, { connector: 'P1', pin: '1' }, []);
        expect(landing.kind).toBe('unwired');
        expect(landing.kind === 'unwired' && landing.reason).toContain('has no pmod_12 connector');
    });

    test('two connectors of the same standard are a choice, not a fact', () => {
        // Built inline: a board with two PMOD ports.
        const pmod = board().connectors.find(connector => connector.id === 'PMOD');
        if (pmod === undefined) { throw new Error('fixture board has no PMOD port'); }
        const two_ports: BoardInfo = {
            ...board(),
            connectors: [pmod, { ...pmod, id: 'PMOD_B', name: 'Second PMOD port' }],
        };

        const landing = land(part(), two_ports, { connector: 'P1', pin: '1' }, []);
        expect(landing.kind).toBe('unwired');
        expect(landing.kind === 'unwired' && landing.reason).toContain('could plug into any of PMOD, PMOD_B');
    });
});

describe('resolving the bus and its chip-select', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('on a matching connector, everything follows with nothing stated', () => {
        // The case the shipped max32655fthr port cannot show: PMOD into PMOD.
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi');
        expectOk(resolved);
        expect(resolved.value.problems).toEqual([]);
        expect(resolved.value.peripheral).toBe('bsp_test_spi_cfg');
        expect(resolved.value.chip_select).toEqual({
            kind: 'native',
            peripheral: 'bsp_test_spi_cfg',
            native_cs: 0,
            at: { connector: 'PMOD', pin: '1' },
        });
    });

    test('a chip-select wired to a header GPIO becomes that GPIO, on its BSP port', () => {
        // Data lines still mate; only CS is moved, as jumper wiring often does.
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', [wire('P1.1', 'H1.1')]);
        expectOk(resolved);
        expect(resolved.value.problems).toEqual([]);
        expect(resolved.value.chip_select).toEqual({
            kind: 'gpio',
            gpio: { port: 'TEST_GPIO1', number: 3 },
            port_extern: 'bsp_test_gpio1_cfg',
            at: { connector: 'H1', pin: '1' },
        });
    });

    test('a GPIO on a port the BSP does not configure is resolved, and the gap reported', () => {
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', [wire('P1.1', 'H1.2')]);
        expectOk(resolved);
        expect(resolved.value.chip_select).toEqual({
            kind: 'gpio',
            gpio: { port: 'TEST_GPIO3', number: 1 },
            port_extern: undefined,
            at: { connector: 'H1', pin: '2' },
        });
        expect(resolved.value.problems.join('\n')).toContain('configures no GPIO port for TEST_GPIO3');
    });

    test('a chip-select on a pin that is neither is reported, with options offered', () => {
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', [wire('P1.1', 'H1.3')]);
        expectOk(resolved);
        expect(resolved.value.chip_select?.kind).toBe('unwired');
        expect(resolved.value.problems.join('\n')).toContain('neither a native chip-select nor a GPIO');
    });

    test('a clock wired to a pin that carries none is reported', () => {
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', [wire('P1.4', 'H1.1')]);
        expectOk(resolved);
        expect(resolved.value.problems.join('\n')).toContain('P1 pin 4 (sck) lands on testboard H1 pin 1, which carries no spi sck');
    });

    test('unwired, it asks, offering the native chip-select first and never on-board pins', () => {
        const resolved = resolve_bus(part(), 'otherboard', 'spi');
        expectOk(resolved);
        expect(resolved.value.peripheral).toBeUndefined();
        expect(resolved.value.chip_select?.kind).toBe('unwired');
        // otherboard declares no pinout at all, so there is nothing to offer.
        expect(resolved.value.chip_select?.kind === 'unwired' && resolved.value.chip_select.options).toEqual([]);
    });

    test('options list the bus native chip-select ahead of plain GPIOs', () => {
        // Data on the PMOD, CS wired somewhere that cannot drive it, so options are offered.
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', [wire('P1.1', 'H1.3')]);
        expectOk(resolved);
        const chip_select = resolved.value.chip_select;
        if (chip_select?.kind !== 'unwired') { throw new Error('expected an unwired chip-select'); }

        const offered = chip_select.options.map(option => `${option.at.connector}.${option.at.pin}`);
        expect(offered[0]).toBe('PMOD.1');
        expect(offered).toContain('H1.1');
        // The on-board LED is already an LED.
        expect(offered).not.toContain('onboard.T0_9');
    });
});

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { board_bus_pins, board_gpio_ports, board_peripheral_kinds } from '../../src/registry/bsp';
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
        // otherboard's second SPI has no `pins:`, so there is nothing about it to join on.
        const buses = board_bus_pins('otherboard');
        expectOk(buses);
        expect(buses.value.map(bus => bus.peripheral)).toEqual(['bsp_test_spi_cfg']);
    });

    test('a chip-select line without native_cs is a plain GPIO line', () => {
        const buses = board_bus_pins('otherboard');
        expectOk(buses);
        expect(buses.value[0]?.signals).toContainEqual({ signal: 'cs', at: { connector: 'H1', pin: '4' } });
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

    test('a board lists the peripheral kinds its board.yml declares, in file order', () => {
        const kinds = board_peripheral_kinds(FIXTURE_BOARD);
        expectOk(kinds);
        // Kinds with no bsp_kinds row are listed too: this is what the board declares.
        expect(kinds.value).toEqual(['spi', 'gpio_port', 'gpio_pin', 'mystery']);

        const other = board_peripheral_kinds('otherboard');
        expectOk(other);
        expect(other.value).toEqual(['spi', 'gpio_port']);
    });

    test('peripheral kinds of an unknown board is an error', () => {
        expectErrorContains(board_peripheral_kinds('noboard'), 'noboard');
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
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', { wires: [wire('P1.1', 'H1.1')] });
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
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', { wires: [wire('P1.1', 'H1.2')] });
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
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', { wires: [wire('P1.1', 'H1.3')] });
        expectOk(resolved);
        expect(resolved.value.chip_select?.kind).toBe('unwired');
        expect(resolved.value.problems.join('\n')).toContain('neither a native chip-select nor a GPIO');
    });

    test('a clock wired to a pin that carries none is reported', () => {
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', { wires: [wire('P1.4', 'H1.1')] });
        expectOk(resolved);
        expect(resolved.value.problems.join('\n')).toContain('P1 pin 4 (sck) lands on testboard H1 pin 1, which carries no spi sck');
        // A bus the data lines do not settle gets no chip-select: it would select nothing that works.
        expect(resolved.value.chip_select?.kind).toBe('unwired');
        expect(resolved.value.connections.map(connection => connection.role)).not.toContain('spi_cs');
    });

    test('a known bus limits the declaration to that bus', () => {
        // twobusboard declares a full set of pins for both buses: on its own the declaration
        // is two pins per signal, a question. The device's controller answers it.
        const open = resolve_bus(part(), 'twobusboard', 'spi');
        expectOk(open);
        expect(open.value.peripheral).toBeUndefined();
        expect(open.value.problems.join('\n')).toContain('2 spi sck pins');

        const known = resolve_bus(part(), 'twobusboard', 'spi', { bus: 'bsp_test_spi2_cfg' });
        expectOk(known);
        expect(known.value.problems).toEqual([]);
        expect(known.value.peripheral).toBe('bsp_test_spi2_cfg');
        expect(known.value.connections.map(connection => `${connection.from.pin}->${connection.to.connector}.${connection.to.pin}`))
            .toEqual(['2->H1.6', '3->H1.7', '4->H1.5', '1->H1.8']);
        expect(known.value.chip_select).toMatchObject({ kind: 'gpio', gpio: { port: 'OTHER_GPIO1', number: 8 } });
    });

    test('a line landing off the controller\'s bus is a problem, and leaves the chip-select unset', () => {
        // Wired onto bsp_test_spi_cfg's pins while the device's controller is the other bus.
        const resolved = resolve_bus(part(), 'otherboard', 'spi', {
            bus: 'bsp_test_spi2_cfg',
            wires: [wire('P1.2', 'H1.2'), wire('P1.3', 'H1.3'), wire('P1.4', 'H1.1')],
        });
        expectOk(resolved);
        expect(resolved.value.problems.join('\n'))
            .toContain("P1 pin 4 (sck) lands on otherboard H1 pin 1, which is bsp_test_spi_cfg's sck, but the device's controller is bsp_test_spi2_cfg");
        expect(resolved.value.chip_select?.kind).toBe('unwired');
    });

    test('jumper-wired, nothing stated: the board declaration settles every line', () => {
        // otherboard has no PMOD port - the max32655fthr case. Its BSP declares one pin per
        // data signal and one chip-select line, so there is nothing to choose.
        const resolved = resolve_bus(part(), 'otherboard', 'spi');
        expectOk(resolved);
        expect(resolved.value.problems).toEqual([]);
        expect(resolved.value.peripheral).toBe('bsp_test_spi_cfg');
        expect(resolved.value.chip_select).toEqual({
            kind: 'gpio',
            gpio: { port: 'OTHER_GPIO1', number: 4 },
            port_extern: 'bsp_other_gpio1_cfg',
            at: { connector: 'H1', pin: '4' },
        });
    });

    test('the connections are the wiring instructions, each saying how it was decided', () => {
        const resolved = resolve_bus(part(), 'otherboard', 'spi', { wires: [wire('P1.1', 'H1.5')] });
        expectOk(resolved);

        const instructions = resolved.value.connections.map(
            connection => `${connection.from.connector}.${connection.from.pin} ${connection.role} -> ${connection.to.connector}.${connection.to.pin} [${connection.via}]`
        );
        expect(instructions).toEqual([
            'P1.2 spi_mosi -> H1.2 [board]',
            'P1.3 spi_miso -> H1.3 [board]',
            'P1.4 spi_sck -> H1.1 [board]',
            // The user's wire wins over the board's convention, and the GPIO follows it.
            'P1.1 spi_cs -> H1.5 [wire]',
        ]);
        expect(resolved.value.chip_select?.kind === 'gpio' && resolved.value.chip_select.gpio).toEqual({ port: 'OTHER_GPIO1', number: 5 });
    });

    test('mating is reported as mating', () => {
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi');
        expectOk(resolved);
        expect(resolved.value.connections.every(connection => connection.via === 'mating')).toBe(true);
    });

    test('two declared chip-select lines are a question, not a pick', () => {
        // The same part with a connector that mates nothing on testboard, whose bus declares
        // two chip-select lines. Data lines still have one declared pin each.
        const unmated: ModuleInfo = {
            ...part(),
            connectors: (part().connectors ?? []).map(connector => ({ ...connector, type: 'feather_12' })),
        };
        const resolved = resolve_bus(unmated, FIXTURE_BOARD, 'spi');
        expectOk(resolved);
        expect(resolved.value.peripheral).toBe('bsp_test_spi_cfg');

        const chip_select = resolved.value.chip_select;
        if (chip_select?.kind !== 'unwired') { throw new Error('expected the chip-select to stay unresolved'); }
        expect(chip_select.reason).toContain('declares 2 chip-select lines (PMOD pin 1, H1 pin 1); say which');
        // Both declared lines are offered first.
        expect(chip_select.options.slice(0, 2).map(option => `${option.at.connector}.${option.at.pin}`)).toEqual(['PMOD.1', 'H1.1']);
    });

    test('a board declaring no pin for a signal leaves that line to be stated', () => {
        // The part gains a line the board's bus declares nothing for, so that line - and
        // only that line - is reported; the rest still resolve.
        const base = part();
        const [p1, ...rest] = base.connectors ?? [];
        if (p1 === undefined) { throw new Error('eval fixture has no connector'); }
        const with_extra_line: ModuleInfo = {
            ...base,
            connectors: [{ ...p1, pins: [...p1.pins, { pin: '7', roles: ['spi_sdio'] }] }, ...rest],
        };

        const resolved = resolve_bus(with_extra_line, 'otherboard', 'spi');
        expectOk(resolved);
        expect(resolved.value.peripheral).toBe('bsp_test_spi_cfg');
        expect(resolved.value.problems).toEqual([
            'eval-testpart P1 pin 7 (sdio): otherboard has no pmod_12 connector for eval-testpart P1 to plug into, and otherboard declares no spi sdio pin, so say where it goes',
        ]);
    });

    test('options list the bus native chip-select ahead of plain GPIOs', () => {
        // Data on the PMOD, CS wired somewhere that cannot drive it, so options are offered.
        const resolved = resolve_bus(part(), FIXTURE_BOARD, 'spi', { wires: [wire('P1.1', 'H1.3')] });
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

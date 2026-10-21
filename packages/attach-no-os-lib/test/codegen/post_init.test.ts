import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap } from '../../src/bootstrap/bootstrap';
import { post_init_blocks } from '../../src/codegen/codegen_helpers';
import { load_devices } from '../../src/codegen/device_loader';
import { schedule_patches } from '../../src/codegen/patch_schedule';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import type { RulesetStruct } from '../../src/ruleset_parser/types';
import { add_symbol, create_workfile } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { expectErrorContains, expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// `$post_init` on a field: an Eta block main.c runs once per node bound there, as soon as
// that node is ready. The fixture's test_spi_device.cs_gpio declares one.

function sensor_on_otherboard(): Workfile {
    const created = create_workfile('othersoc');
    expectOk(created);
    created.value.board = 'otherboard';
    const ruleset = load_resolved_ruleset('test_sensor');
    expectOk(ruleset);
    expectOk(add_symbol(created.value, 'sensor', ruleset.value));
    expectOk(attach_eval_board(created.value, 'eval-testpart', 'sensor'));
    expectOk(bootstrap(created.value));
    return created.value;
}

describe('$post_init parsing', () => {
    test('an include keeps its template', () => {
        const parsed = parse_ruleset('$type: struct\n$symbol: t\npin: {include: p, pointer: true, $post_init: "go(<%= it.target %>);"}\n');
        expectOk(parsed);
        expect((parsed.value as RulesetStruct).properties[0]?.post_init).toBe('go(<%= it.target %>);');
    });

    test('a field that binds no node cannot have one', () => {
        expectErrorContains(parse_ruleset('$type: struct\n$symbol: t\nn: {type: uint8_t, $post_init: "x();"}\n'), 'bind a node');
    });
});

describe('$post_init in main.c', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('renders once per bound node, with the target, owner and field', () => {
        const blocks = post_init_blocks(sensor_on_otherboard());
        expect(blocks).toEqual([{ node: 'sensor_cs_gpio', code: 'test_gpio_pin_set_output(&sensor_cs_gpio, sensor_spi_dev.cs_gpio_num);' }]);
    });

    test('runs once the pin is ready: after its port init and port patch, before the sensor init', () => {
        const workfile = sensor_on_otherboard();
        const devices = load_devices(workfile).map(device => device.descriptor_name);
        const schedule = schedule_patches(
            [{ struct_name: 'sensor_cs_gpio', field_path: 'port_handle', value: 'bsp_other_gpio1_cfg_handle', source: 'bsp_other_gpio1_cfg_handle' }],
            devices,
            post_init_blocks(workfile),
        );
        expect(schedule.post_init_before).toEqual([]);
        expect(schedule.post_init_after.get('bsp_other_gpio1_cfg_handle')?.map(block => block.node)).toEqual(['sensor_cs_gpio']);
        expect(devices.indexOf('bsp_other_gpio1_cfg_handle')).toBeLessThan(devices.indexOf('sensor'));
    });
});

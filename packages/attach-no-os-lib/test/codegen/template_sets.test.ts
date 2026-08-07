import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import {
    DEFAULT_TEMPLATE_SET,
    TEMPLATES_ROOT,
    configured_template_set,
    list_template_sets,
    resolve_template_set,
} from '../../src/codegen/template_sets';
import { set_setting_value } from '../../src/settings/settings';
import { expectOk, expectError, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');

// Minimal but real workfile: one platform SPI init_param is enough to render, and
// these tests care about WHICH templates run, not what they emit.
const test_workfile: MinimalWorkfile = {
    platform: "max32690",
    symbols: {
        "max_spi_ip": {
            "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
            "vssel": "MXC_GPIO_VSSEL_VDDIOH",
            "polarity": "SPI_SS_POL_LOW"
        }
    }
};

describe('template sets', () => {
    let temporary_directory: string;
    // An out-of-tree set, to prove a user can point the setting at their own folder.
    let custom_set: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'template-set-test-'));

        custom_set = path.join(temporary_directory, 'my_templates');
        fs.mkdirSync(custom_set, { recursive: true });
        fs.writeFileSync(
            path.join(custom_set, 'project_structure.json'),
            JSON.stringify({ files: [{ template: "readme.eta", output: "README.md", protect: false }] })
        );
        fs.writeFileSync(path.join(custom_set, 'readme.eta'), 'Project: <%= it.project_name %>\n');
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    function generate_with(template_set?: string) {
        const import_result = import_minimal(test_workfile);
        expectOk(import_result);

        return generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
            template_set,
        });
    }

    describe('discovery', () => {
        test('the bundled no-os set is found', () => {
            expect(list_template_sets()).toContain(DEFAULT_TEMPLATE_SET);
        });

        test('every listed set lives under the templates root and has a manifest', () => {
            for (const name of list_template_sets()) {
                expect(fs.existsSync(path.join(TEMPLATES_ROOT, name, 'project_structure.json'))).toBe(true);
            }
        });
    });

    describe('resolution', () => {
        test('defaults to the no-os set when the setting is unset', () => {
            expect(configured_template_set()).toBe(DEFAULT_TEMPLATE_SET);

            const result = resolve_template_set();
            expectOk(result);
            expect(result.value).toBe(path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE_SET));
        });

        test('a bare name resolves under the templates root', () => {
            const result = resolve_template_set(DEFAULT_TEMPLATE_SET);
            expectOk(result);
            expect(result.value).toBe(path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE_SET));
        });

        test('the template_set setting selects the set', () => {
            expectOk(set_setting_value('template_set', custom_set));

            expect(configured_template_set()).toBe(custom_set);

            const result = resolve_template_set();
            expectOk(result);
            expect(result.value).toBe(custom_set);
        });

        test('an explicit name overrides the setting', () => {
            expectOk(set_setting_value('template_set', custom_set));

            const result = resolve_template_set(DEFAULT_TEMPLATE_SET);
            expectOk(result);
            expect(result.value).toBe(path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE_SET));
        });

        test('an unknown set fails and lists what is available', () => {
            const result = resolve_template_set('does_not_exist');
            expectError(result);
            expect(result.error.message).toContain('does_not_exist');
            expect(result.error.message).toContain(DEFAULT_TEMPLATE_SET);
        });

        test('a folder without a manifest is not a usable set', () => {
            const bare = path.join(temporary_directory, 'bare');
            fs.mkdirSync(bare, { recursive: true });

            const result = resolve_template_set(bare);
            expectError(result);
            expect(result.error.message).toContain('project_structure.json');
        });
    });

    describe('codegen honors the selected set', () => {
        test('the default set generates the no-OS project layout', () => {
            const result = generate_with();
            expectOk(result);

            expect(fs.existsSync(path.join(temporary_directory, 'test-project/Makefile'))).toBe(true);
            expect(fs.existsSync(path.join(temporary_directory, 'test-project/src/main.c'))).toBe(true);
        });

        test('a different set generates that set\'s files instead', () => {
            const result = generate_with(custom_set);
            expectOk(result);

            expect(result.value.files_created).toHaveLength(1);

            const readme = path.join(temporary_directory, 'test-project/README.md');
            expect(fs.readFileSync(readme, 'utf8')).toBe('Project: test-project\n');
            // The no-OS layout must NOT appear — the set fully replaces it.
            expect(fs.existsSync(path.join(temporary_directory, 'test-project/Makefile'))).toBe(false);
        });

        test('the setting alone switches what codegen renders', () => {
            expectOk(set_setting_value('template_set', custom_set));

            const result = generate_with();
            expectOk(result);

            expect(fs.existsSync(path.join(temporary_directory, 'test-project/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(temporary_directory, 'test-project/Makefile'))).toBe(false);
        });

        test('an unknown set writes nothing at all', () => {
            const result = generate_with('does_not_exist');
            expectError(result);

            // The failure is caught during resolution, before any file is created.
            expect(fs.existsSync(path.join(temporary_directory, 'test-project'))).toBe(false);
        });

        test('a manifest naming a missing template is rejected', () => {
            fs.writeFileSync(
                path.join(custom_set, 'project_structure.json'),
                JSON.stringify({ files: [{ template: "absent.eta", output: "out.txt", protect: false }] })
            );

            const result = generate_with(custom_set);
            expectError(result);
            expect(result.error.message).toContain('absent.eta');
        });
    });
});

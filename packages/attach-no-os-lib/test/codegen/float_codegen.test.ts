import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { validate_workfile } from '../../src/validator/validator';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');

// `no_os_ain_init_param.vref` is declared `type: float`, so it exercises the
// float literal path end to end through the real schemas.
function ain_workfile(vref?: number): MinimalWorkfile {
    return {
        platform: "max32690",
        symbols: {
            "ain_ip": {
                "$compatible": "no-os/ain/no_os_ain_init_param.yaml",
                ...(vref === undefined ? {} : { vref })
            }
        }
    };
}

describe('float codegen', () => {
    let temporary_directory: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'float-codegen-'));
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    function generate(vref: number): string {
        const import_result = import_minimal(ain_workfile(vref));
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "float-test",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });
        expectOk(result);

        return fs.readFileSync(
            path.join(temporary_directory, "float-test/src/common/common_data.c"),
            "utf8"
        );
    }

    test('fractional float value emits an f suffix', () => {
        expect(generate(3.3)).toContain(".vref = 3.3f,");
    });

    // A bare `5` in a float field is an int literal in C; the `.0` keeps the token
    // floating-point so later arithmetic on it does not truncate.
    test('whole float value still emits a floating-point token', () => {
        expect(generate(5)).toContain(".vref = 5.0f,");
    });

    test('negative float value keeps its sign and suffix', () => {
        expect(generate(-1.25)).toContain(".vref = -1.25f,");
    });

    test('a fractional float value validates clean', () => {
        const import_result = import_minimal(ain_workfile(3.3));
        expectOk(import_result);

        const result = validate_workfile(import_result.value);
        expect(result.errors.filter(error => error.severity === "error")).toHaveLength(0);
    });
});

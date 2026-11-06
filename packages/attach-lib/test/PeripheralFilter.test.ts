import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { Attach, Result, type ControllerContext, type ParsedBinding } from 'attach-lib';

import { afterAll, describe, test, expect } from 'vitest';

// Which peripheral properties a binding offers under its parent (`ParseOptions.controller`): another controller's
// vendor ones go, and so do the SPI ones under a parent that isn't an SPI controller. The narrowed binding too.

const linux_path = path.resolve(__dirname, 'linux');
const dt_schema_path = path.resolve(__dirname, 'dt-schema');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-peripheral-'));

afterAll(() => { fs.rmSync(directory, { recursive: true }); });

/** A chip on I2C or SPI, as adxl345's binding is: spi-peripheral-props for every node, and spi-cpha of its own. */
const DUAL_BUS = `
properties:
  compatible:
    const: x,dual
  reg:
    maxItems: 1
  spi-cpha: true
required:
  - compatible
  - reg
allOf:
  - $ref: /schemas/spi/spi-peripheral-props.yaml#
unevaluatedProperties: false
`;

async function parsed(name: string, body: string, controller?: ControllerContext): Promise<Attach> {
    const file = path.join(directory, `${name}.yaml`);
    fs.writeFileSync(file, `$id: http://devicetree.org/schemas/test/${name}.yaml#\n$schema: http://devicetree.org/meta-schemas/core.yaml#\ntitle: ${name}\nmaintainers: [someone]\n${body}`);
    const result = await Attach.parse(file, { linux: linux_path, dt_schema: dt_schema_path }, controller === undefined ? undefined : { controller });
    if (Result.is_err(result)) { expect.fail(`${result.error.stage}: ${result.error.message}`); }
    return result.value;
}

const keys = (binding: ParsedBinding | undefined): string[] => binding?.properties.map(p => p.key) ?? [];

/** The properties of the binding as parsed, and once narrowed for a node that has only its compatible and reg. */
async function offered(body: string, controller?: ControllerContext): Promise<{ parsed: string[], narrowed: string[] }> {
    const attach = await parsed('dual', body, controller);
    return {
        parsed: keys(attach.parsed_binding),
        narrowed: keys(attach.narrow_binding(JSON.stringify({ compatible: ['x,dual'], reg: [[0]] }))),
    };
}

const i2c: ControllerContext = { compatibles: ['brcm,bcm2711-i2c', 'brcm,bcm2835-i2c'], name: 'i2c@7e804000' };
const spi: ControllerContext = { compatibles: ['brcm,bcm2835-spi'], name: 'spi@7e204000' };

describe('peripheral properties', () => {
    test('under an SPI controller the SPI properties stay and the other controllers\' vendor ones go, narrowed too', async () => {
        const { parsed, narrowed } = await offered(DUAL_BUS, spi);
        for (const properties of [parsed, narrowed]) {
            expect(properties).toEqual(expect.arrayContaining(['reg', 'spi-cpha', 'spi-max-frequency', 'spi-rx-bus-width']));
            expect(properties.filter(key => /^(pl022|cdns|fsl|nvidia|st),|^controller-data$/.test(key))).toEqual([]);
        }
    });

    test('under a parent that is not an SPI controller the SPI properties go, the binding\'s own ones too, narrowed too', async () => {
        const { parsed, narrowed } = await offered(DUAL_BUS, i2c);
        expect(parsed).toEqual(['compatible', 'reg', 'status', 'pinctrl-names']);
        expect(narrowed).toEqual(['compatible', 'reg', 'status', 'pinctrl-names']);
    });

    test('an SPI property the binding requires stays under any parent', async () => {
        const { parsed, narrowed } = await offered(DUAL_BUS.replace('  - reg\n', '  - reg\n  - spi-max-frequency\n'), i2c);
        expect(parsed).toEqual(['compatible', 'reg', 'spi-max-frequency', 'status', 'pinctrl-names']);
        expect(narrowed).toEqual(['compatible', 'reg', 'spi-max-frequency', 'status', 'pinctrl-names']);
    });

    test('a parent whose name is not given keeps the SPI properties', async () => {
        const { compatibles } = i2c;
        const { parsed, narrowed } = await offered(DUAL_BUS, { compatibles });
        expect(parsed).toContain('spi-max-frequency');
        expect(narrowed).toContain('spi-max-frequency');
    });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { Attach, Result, type ParsedBinding, type ResolvedProperty } from 'attach-lib';

import { afterAll, describe, test, expect } from 'vitest';

// The rules of the pipeline stages before the fixups (references, `true` placeholders, allOf
// redefinitions, if/then canaries), each seen through what `Attach.parse` gives for a small binding.

const linux_path = path.resolve(__dirname, 'linux');
const dt_schema_path = path.resolve(__dirname, 'dt-schema');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-pipeline-'));

afterAll(() => { fs.rmSync(directory, { recursive: true }); });

/** Parses a binding with this body (after the `$id`, `title` and `maintainers` every binding has). */
async function parse(name: string, body: string): Promise<Result<Attach, { stage: string, message: string }>> {
    const file = path.join(directory, `${name}.yaml`);
    fs.writeFileSync(file, `$id: http://devicetree.org/schemas/test/${name}.yaml#\n$schema: http://devicetree.org/meta-schemas/core.yaml#\ntitle: ${name}\nmaintainers: [someone]\n${body}`);
    return Attach.parse(file, { linux: linux_path, dt_schema: dt_schema_path });
}

async function parsed(name: string, body: string): Promise<Attach> {
    const result = await parse(name, body);
    if (Result.is_err(result)) { expect.fail(`${result.error.stage}: ${result.error.message}`); }
    return result.value;
}

const property = (binding: ParsedBinding, key: string): ResolvedProperty['value'] | undefined =>
    binding.properties.find(p => p.key === key)?.value;

const spi_max_frequency = {
    _t: 'scalar',
    cell: { _t: 'number', minimum: 0n, maximum: 0xFF_FF_FF_FFn },
    typeSize: 32,
    description: 'Maximum SPI clocking speed of the device in Hz.',
};

describe('references', () => {
    test('the properties of a schema the binding references are offered', async () => {
        const { parsed_binding } = await parsed('referenced', `
allOf:
  - $ref: /schemas/spi/spi-peripheral-props.yaml#
properties:
  compatible:
    const: x,y
`);
        expect(property(parsed_binding, 'spi-max-frequency')).toStrictEqual(spi_max_frequency);
    });

    test('a reference to a file that is in neither tree fails at the references stage', async () => {
        const result = await parse('missing', `
allOf:
  - $ref: /schemas/nope/nope.yaml#
properties:
  compatible:
    const: x,y
`);
        if (Result.is_ok(result)) { expect.fail('expected the parse to fail'); }
        expect(result.error.stage).toBe('references');
        expect(result.error.message).toContain('/schemas/nope/nope.yaml');
    });

    test('a property keeps the types.yaml type it references: a matrix and an array that dereference alike stay apart', async () => {
        const { parsed_binding } = await parsed('typed', `
properties:
  compatible:
    const: x,y
  adi,matrix:
    $ref: /schemas/types.yaml#/definitions/uint32-matrix
  adi,array:
    $ref: /schemas/types.yaml#/definitions/uint32-array
`);
        const uint32 = { _t: 'number', minimum: 0n, maximum: 0xFF_FF_FF_FFn };
        expect(property(parsed_binding, 'adi,matrix')).toStrictEqual({ _t: 'matrix', minItems: 1, rows: [{ _t: 'list', item: uint32, minItems: 1, typeSize: 32 }] });
        expect(property(parsed_binding, 'adi,array')).toStrictEqual({ _t: 'list', item: uint32, minItems: 1, typeSize: 32 });
    });

    test('a schema that references itself (i2c-controller\'s i2c-bus) still resolves, the inner node empty', async () => {
        const { parsed_binding } = await parsed('self-referencing', `
allOf:
  - $ref: /schemas/i2c/i2c-controller.yaml#
properties:
  compatible:
    const: x,y
`);
        expect(property(parsed_binding, 'i2c-bus')).toStrictEqual({ _t: 'node', properties: [] });
        expect(property(parsed_binding, '#size-cells')).toMatchObject({ _t: 'scalar', cell: { _t: 'enum', enum: [0n] } });
    });
});

describe('placeholders', () => {
    test('a `true` property takes its definition from a schema referenced anywhere in the binding', async () => {
        // The reference is under a child node, so only the definition found in it can fill the top-level property
        const { parsed_binding } = await parsed('placeholder', `
properties:
  compatible:
    const: x,y
  spi-max-frequency: true
patternProperties:
  "^dev@[0-9]$":
    type: object
    $ref: /schemas/spi/spi-peripheral-props.yaml#
`);
        expect(property(parsed_binding, 'spi-max-frequency')).toStrictEqual(spi_max_frequency);
    });

    test('a `true` property no referenced schema defines stays unknown', async () => {
        const { parsed_binding } = await parsed('placeholder-alone', `
properties:
  compatible:
    const: x,y
  spi-max-frequency: true
`);
        expect(property(parsed_binding, 'spi-max-frequency')).toStrictEqual({ _t: 'unknown' });
    });
});

describe('redefinitions', () => {
    test('a property an allOf entry defines again is merged into one, the binding\'s own keywords winning', async () => {
        const { parsed_binding } = await parsed('redefined', `
allOf:
  - properties:
      adi,gain:
        description: from the allOf
        $ref: /schemas/types.yaml#/definitions/uint32
        maximum: 10
properties:
  compatible:
    const: x,y
  adi,gain:
    maximum: 4
`);
        expect(property(parsed_binding, 'adi,gain')).toStrictEqual({
            _t: 'scalar',
            cell: { _t: 'number', minimum: 0n, maximum: 4n },
            typeSize: 32,
            description: 'from the allOf',
        });
    });
});

describe('if/then branches', () => {
    test('a then branch that only constrains a property narrows it when its condition holds', async () => {
        const attach = await parsed('branch', `
properties:
  compatible:
    enum: ["x,a", "x,b"]
  adi,mode:
    $ref: /schemas/types.yaml#/definitions/uint32
    maximum: 7
allOf:
  - if:
      properties:
        compatible:
          const: x,b
    then:
      properties:
        adi,mode:
          maximum: 3
`);
        const maximum = (compatible: string) => {
            const narrowed = attach.update_binding_by_changes(JSON.stringify({ compatible: [compatible] }));
            const mode = narrowed === undefined ? undefined : property(narrowed.binding, 'adi,mode');
            return mode?._t === 'scalar' && mode.cell._t === 'number' ? mode.cell.maximum : undefined;
        };
        expect(maximum('x,a')).toBe(7n);
        expect(maximum('x,b')).toBe(3n);
    });
});

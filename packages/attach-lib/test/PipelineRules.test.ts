import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { Attach, Result, type ParsedBinding, type ResolvedProperty } from 'attach-lib';

import { afterAll, describe, test, expect } from 'vitest';

// The rules of the pipeline stages other than the fixups (references, `true` placeholders, allOf
// redefinitions, if/then canaries, the `select: true` schemas), each seen through what `Attach.parse`
// gives for a small binding.

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

/** A list's or a matrix's `[minItems, maxItems]`. */
const counts = (type: ResolvedProperty['value'] | undefined) =>
    type?._t === 'list' || type?._t === 'matrix' ? [type.minItems, type.maxItems] : undefined;

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

    test('a property\'s own count is fixed before the types.yaml type it references adds its minItems: 1', async () => {
        const { parsed_binding } = await parsed('counted', `
properties:
  compatible:
    const: x,y
  adi,names:
    $ref: /schemas/types.yaml#/definitions/string-array
    items:
      - const: a
      - const: b
  adi,table:
    $ref: /schemas/types.yaml#/definitions/uint8-array
    maxItems: 4
  adi,range:
    $ref: /schemas/types.yaml#/definitions/int32-array
    minItems: 2
    maxItems: 4
  adi,open:
    $ref: /schemas/types.yaml#/definitions/uint32-array
`);
        expect(counts(property(parsed_binding, 'adi,names'))).toStrictEqual([2, 2]);
        expect(counts(property(parsed_binding, 'adi,table'))).toStrictEqual([4, 4]);
        expect(counts(property(parsed_binding, 'adi,range'))).toStrictEqual([2, 4]);
        expect(counts(property(parsed_binding, 'adi,open'))).toStrictEqual([1, undefined]);
    });

    test('a property keeps its own keywords beside a $ref that a property before it already resolved', async () => {
        const { parsed_binding } = await parsed('referenced-again', `
properties:
  compatible:
    const: x,y
  adi,first:
    $ref: /schemas/types.yaml#/definitions/uint32
  adi,pin:
    description: d
    minimum: 1
    maximum: 6
    $ref: /schemas/types.yaml#/definitions/uint32
  adi,table:
    $ref: /schemas/types.yaml#/definitions/uint32-array
  adi,channels:
    minItems: 8
    maxItems: 12
    $ref: /schemas/types.yaml#/definitions/uint32-array
`);
        expect(property(parsed_binding, 'adi,pin')).toMatchObject({ _t: 'scalar', cell: { _t: 'number', minimum: 1n, maximum: 6n } });
        expect(counts(property(parsed_binding, 'adi,channels'))).toStrictEqual([8, 12]);
    });

    test('the items a property gives are merged into those of the types.yaml type it references', async () => {
        const { parsed_binding } = await parsed('merged-items', `
properties:
  compatible:
    const: x,y
  adi,channels:
    $ref: /schemas/types.yaml#/definitions/uint32-array
    maxItems: 4
    items:
      default: 0
`);
        expect(property(parsed_binding, 'adi,channels')).toMatchObject({
            _t: 'list', item: { _t: 'number', minimum: 0n, maximum: 0xFF_FF_FF_FFn }, typeSize: 32,
        });
    });

    test('a node that references a schema has its properties and its own, but only its own when additionalProperties is false', async () => {
        const channel = async (name: string, closing: string) => {
            const { parsed_binding } = await parsed(name, `
properties:
  compatible:
    const: x,y
patternProperties:
  "^channel@[0-7]$":
    $ref: /schemas/iio/adc/adc.yaml
    type: object
    ${closing}
    properties:
      reg:
        maximum: 7
`);
            return parsed_binding.pattern_properties?.find(rule => rule.pattern === '^channel@[0-7]$')?.properties.map(p => p.key);
        };

        expect(await channel('merged-node', 'unevaluatedProperties: false')).toEqual(expect.arrayContaining(['reg', 'bipolar', 'diff-channels']));
        expect(await channel('closed-node', 'additionalProperties: false')).toStrictEqual(['reg', 'status', 'pinctrl-names']);
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

    test('a `true` property its node\'s allOf defines takes that definition, not a child node\'s of the same name', async () => {
        // spi-controller's devices have a `reg` of their own (one entry of a chip select)
        const { parsed_binding } = await parsed('placeholder-in-node', `
allOf:
  - $ref: /schemas/spi/spi-controller.yaml#
  - properties:
      reg:
        minItems: 2
        maxItems: 2
properties:
  compatible:
    const: x,y
  reg: true
`);
        expect(counts(property(parsed_binding, 'reg'))).toStrictEqual([2, 2]);
        expect(property(parsed_binding, 'reg')).not.toHaveProperty('description');
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

    test('the binding\'s own count wins over the bounds of the allOf entry that defines the property again', async () => {
        const { parsed_binding } = await parsed('redefined-count', `
allOf:
  - properties:
      adi,regs:
        $ref: /schemas/types.yaml#/definitions/uint32-array
        minItems: 2
        maxItems: 7
properties:
  compatible:
    const: x,y
  adi,regs:
    items:
      - const: 1
      - const: 2
      - const: 3
`);
        expect(counts(property(parsed_binding, 'adi,regs'))).toStrictEqual([3, 3]);
    });

    test('a string the binding gives a property is one value, whatever count the allOf entry that defines it again allows', async () => {
        const { parsed_binding } = await parsed('redefined-string', `
allOf:
  - properties:
      adi,names:
        minItems: 1
        maxItems: 8
        contains:
          enum: [a, b]
properties:
  compatible:
    const: x,y
  adi,names:
    const: a
  adi,modes:
    enum: [c, d]
    maxItems: 2
`);
        expect(counts(property(parsed_binding, 'adi,names'))).toStrictEqual([1, 1]);
        expect(counts(property(parsed_binding, 'adi,modes'))).toStrictEqual([1, 2]);
    });

    test('every definition of a property is merged into one, the nearest one\'s keywords winning and the tighter bounds', async () => {
        const { parsed_binding } = await parsed('redefined-thrice', `
allOf:
  - properties:
      adi,gain:
        description: from the allOf
        $ref: /schemas/types.yaml#/definitions/uint32
        maximum: 10
      adi,regs:
        $ref: /schemas/types.yaml#/definitions/uint32-array
        minItems: 2
        maxItems: 7
    allOf:
      - properties:
          adi,gain:
            description: from the nested allOf
            minimum: 2
properties:
  compatible:
    const: x,y
  adi,gain:
    maximum: 4
  adi,regs:
    minItems: 1
    maxItems: 4
`);
        expect(parsed_binding.properties.filter(p => p.key === 'adi,gain')).toHaveLength(1);
        expect(property(parsed_binding, 'adi,gain')).toMatchObject({
            _t: 'scalar',
            cell: { _t: 'number', minimum: 2n, maximum: 4n },
            description: 'from the allOf',
        });
        expect(counts(property(parsed_binding, 'adi,regs'))).toStrictEqual([2, 4]);
    });

    test('a property only allOf entries define is merged too, and so is one of a child node', async () => {
        const { parsed_binding } = await parsed('redefined-in-allOf', `
allOf:
  - properties:
      adi,mode:
        description: near
        $ref: /schemas/types.yaml#/definitions/uint32
    allOf:
      - properties:
          adi,mode:
            description: far
            maximum: 3
properties:
  compatible:
    const: x,y
patternProperties:
  "^part@[0-9]$":
    type: object
    allOf:
      - properties:
          reg:
            maximum: 9
    properties:
      reg:
        description: of the part
`);
        expect(parsed_binding.properties.filter(p => p.key === 'adi,mode')).toHaveLength(1);
        expect(property(parsed_binding, 'adi,mode')).toMatchObject({ cell: { _t: 'number', maximum: 3n }, description: 'near' });

        const part = parsed_binding.pattern_properties?.find(rule => rule.pattern === '^part@[0-9]$')?.properties ?? [];
        expect(part.filter(p => p.key === 'reg')).toHaveLength(1);
        expect(part.find(p => p.key === 'reg')?.value).toMatchObject({ description: 'of the part' });
    });

    test('a property of a child node an allOf entry describes is not a redefinition of the node\'s own', async () => {
        const { parsed_binding } = await parsed('redefined-child', `
allOf:
  - patternProperties:
      "^part@[0-9]$":
        type: object
        properties:
          adi,gain:
            description: of a child node
            maximum: 10
properties:
  compatible:
    const: x,y
  adi,gain:
    $ref: /schemas/types.yaml#/definitions/uint32
`);
        expect(property(parsed_binding, 'adi,gain')).toStrictEqual({
            _t: 'scalar',
            cell: { _t: 'number', minimum: 0n, maximum: 0xFF_FF_FF_FFn },
            typeSize: 32,
        });
    });
});

describe('selected schemas', () => {
    test('a property the binding names gets the counts the select: true schema that defines it gives, the binding\'s keywords winning', async () => {
        const { parsed_binding } = await parsed('selected', `
properties:
  compatible:
    const: x,y
  mount-matrix:
    description: of the part
patternProperties:
  "^part@[0-9]$":
    type: object
    properties:
      mount-matrix: true
`);
        const nine_strings = { _t: 'list', item: { _t: 'string' }, minItems: 9, maxItems: 9 };
        expect(property(parsed_binding, 'mount-matrix')).toStrictEqual({ ...nine_strings, description: 'of the part' });

        const part = parsed_binding.pattern_properties?.find(rule => rule.pattern === '^part@[0-9]$')?.properties ?? [];
        expect(part.find(p => p.key === 'mount-matrix')?.value).toMatchObject(nine_strings);
    });

    test('a child node named like a property of a select: true schema stays a node', async () => {
        const { parsed_binding } = await parsed('selected-node', `
properties:
  compatible:
    const: x,y
  clocks:
    type: object
    properties:
      compatible:
        const: x,clocks
`);
        // clock.yaml's `clocks` is a phandle-array
        expect(property(parsed_binding, 'clocks')).toMatchObject({ _t: 'node' });
    });

    test('a select: true schema adds no property the binding doesn\'t name', async () => {
        const { parsed_binding } = await parsed('selected-unnamed', `
properties:
  compatible:
    const: x,y
`);
        expect(parsed_binding.properties.map(p => p.key)).toStrictEqual(['compatible']);
    });

    test('the tighter bound of the binding\'s and the select: true schema\'s holds', async () => {
        const { parsed_binding } = await parsed('selected-tighter', `
properties:
  compatible:
    const: x,y
  enable-gpios:
    minItems: 1
    maxItems: 2
`);
        // gpio-consumer-common.yaml: `enable-gpios: {maxItems: 1}`
        expect(counts(property(parsed_binding, 'enable-gpios'))).toStrictEqual([1, 1]);
    });

    test('the one type a property has is kept when the select: true schema allows it among others', async () => {
        const { parsed_binding } = await parsed('selected-typed', `
properties:
  compatible:
    const: x,y
  clock-frequency: true
`);
        // clock.yaml: `clock-frequency: {anyOf: [uint32, uint64]}`; `dt_type` gives the name the first
        expect(property(parsed_binding, 'clock-frequency')).toMatchObject({
            _t: 'scalar', cell: { _t: 'number', maximum: 0xFF_FF_FF_FFn }, typeSize: 32,
        });
    });

    test('a node that forbids other properties has pinctrl-names and pinctrl-N, typed by pinctrl-consumer.yaml', async () => {
        const { parsed_binding } = await parsed('selected-pinctrl', `
properties:
  compatible:
    const: x,y
unevaluatedProperties: false
`);
        expect(property(parsed_binding, 'pinctrl-names')).toMatchObject({ _t: 'list', item: { _t: 'string' } });
        expect(parsed_binding.property_patterns?.find(rule => rule.pattern === '^pinctrl-[0-9]+$')?.value)
            .toMatchObject({ _t: 'matrix', rows: [{ _t: 'list', minItems: 1, maxItems: 1024 }] });
    });

    test('a node that names a pinctrl-N, or allows any property, gets no pinctrl properties', async () => {
        const pinctrl = async (name: string, body: string) => {
            const { parsed_binding } = await parsed(name, `
properties:
  compatible:
    const: x,y
${body}
`);
            return [...keys_of(parsed_binding.properties), ...keys_of(parsed_binding.property_patterns ?? [])].filter(key => key.includes('pinctrl'));
        };
        expect(await pinctrl('own-pinctrl', '  pinctrl-0: true\nunevaluatedProperties: false')).toStrictEqual(['pinctrl-0']);
        expect(await pinctrl('open-pinctrl', 'additionalProperties: true')).toStrictEqual([]);
    });

    test('a property pattern of a select: true schema types only the pattern of the same key', async () => {
        const { parsed_binding } = await parsed('selected-pattern', `
properties:
  compatible:
    const: x,y
patternProperties:
  "^pinctrl-[0-9]$": true
`);
        expect(parsed_binding.property_patterns?.find(rule => rule.pattern === '^pinctrl-[0-9]$')?.value).toMatchObject({ _t: 'unknown' });
    });
});

const keys_of = (rules: ({ key: string } | { pattern: string })[]): string[] => rules.map(rule => 'key' in rule ? rule.key : rule.pattern);

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
            const narrowed = attach.narrow_binding(JSON.stringify({ compatible: [compatible] }));
            const mode = narrowed === undefined ? undefined : property(narrowed, 'adi,mode');
            return mode?._t === 'scalar' && mode.cell._t === 'number' ? mode.cell.maximum : undefined;
        };
        expect(maximum('x,a')).toBe(7n);
        expect(maximum('x,b')).toBe(3n);
    });
});

describe('branch narrowing takes what dt-schema takes', () => {
    test('two child-node patterns that are the same schema both narrow', async () => {
        // s2mpu02's `^LDO..$` and `^BUCK[1-7]$`, both regulator.yaml
        const attach = await parsed('same-pattern-schema', `
patternProperties:
  "^LDO[0-9]$":
    type: object
    $ref: /schemas/regulator/regulator.yaml#
  "^BUCK[0-9]$":
    type: object
    $ref: /schemas/regulator/regulator.yaml#
`);
        expect(attach.patterns).toStrictEqual(['^LDO[0-9]$', '^BUCK[0-9]$']);
        expect(attach.narrow_pattern_binding('^BUCK[0-9]$', '{}')).toBeDefined();
    });

    test('a pattern is read as Python reads it: an escaped dash, and {,n} for {0,n}', async () => {
        const attach = await parsed('python-pattern', `
properties:
  compatible:
    const: x,y
  x,label:
    $ref: /schemas/types.yaml#/definitions/string
    pattern: '^a\\-b(-c){,1}$'
  x,mode:
    $ref: /schemas/types.yaml#/definitions/uint32
    maximum: 7
allOf:
  - if:
      properties:
        x,label:
          pattern: '^a\\-b(-c){,1}$'
    then:
      properties:
        x,mode:
          maximum: 3
`);
        const maximum = (label: string) => {
            const narrowed = attach.narrow_binding(JSON.stringify({ compatible: ['x,y'], 'x,label': [label] }));
            const mode = narrowed === undefined ? undefined : property(narrowed, 'x,mode');
            return mode?._t === 'scalar' && mode.cell._t === 'number' ? mode.cell.maximum : undefined;
        };
        expect(maximum('a-b-c')).toBe(3n);
        expect(maximum('a-b-c-c')).toBe(7n);
    });

    test('a property whose description is left empty is still offered', async () => {
        // emc2305's `emcs205,max-state`
        const { parsed_binding } = await parsed('empty-description', `
properties:
  compatible:
    const: x,y
  x,max-state:
    description:
    maxItems: 1
`);
        expect(parsed_binding.properties.map(p => p.key)).toContain('x,max-state');
    });
});

describe('a single integer of a scalar type', () => {
    // at91rm9200-gpio's `#gpio-lines: {maxItems: 1}`: `items_size` makes it an array of one, the name's type a uint32
    test('a property of a scalar integer type given only maxItems: 1 is the scalar its type gives', async () => {
        const { parsed_binding } = await parsed('single-integer', `
properties:
  compatible:
    const: x,y
  "#foo-cells":
    maxItems: 1
    default: 32
`);
        expect(property(parsed_binding, '#foo-cells')).toStrictEqual({
            _t: 'scalar',
            cell: { _t: 'number', minimum: 0n, maximum: 0xFF_FF_FF_FFn },
            typeSize: 32,
            default: 32n,
        });
    });

    test('with maxItems: 2 it stays a list', async () => {
        const { parsed_binding } = await parsed('two-integers', `
properties:
  compatible:
    const: x,y
  "#foo-cells":
    maxItems: 2
`);
        expect(property(parsed_binding, '#foo-cells')?._t).toBe('list');
    });
});

describe('selected patterns that are a node or a property', () => {
    const pattern = (binding: ParsedBinding, key: string) => binding.property_patterns?.find(rule => rule.pattern === key)?.value;

    // dt-core.yaml's `.*-supply$` is a node or a phandle: a binding's pattern of the key is the phandle
    test('a binding\'s .*-supply$ pattern is the phandle of dt-core\'s', async () => {
        const { parsed_binding } = await parsed('supply-pattern', `
properties:
  compatible:
    const: x,y
patternProperties:
  ".*-supply$":
    description: Input supply phandle(s) for this node
`);
        expect(pattern(parsed_binding, '.*-supply$')).toStrictEqual({
            _t: 'matrix',
            minItems: 1,
            maxItems: 1,
            rows: [{ _t: 'list', item: { _t: 'any' }, minItems: 1, maxItems: 1 }],
            description: 'Input supply phandle(s) for this node',
        });
    });

    test('a child-node pattern of dt-core\'s is merged into nothing', async () => {
        const { parsed_binding } = await parsed('node-pattern', `
properties:
  compatible:
    const: x,y
patternProperties:
  "^__.*__$":
    description: Not a node here
`);
        expect(pattern(parsed_binding, '^__.*__$')).toMatchObject({ _t: 'unknown' });
    });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { Attach, PARSE_STEPS, Result, fixup_passes, type TraceEvent } from 'attach-lib';

import { afterAll, describe, test, expect } from 'vitest';

import { BINDINGS, schema_paths, snapshot } from './bindings';

// `ParseOptions.trace`: what each step of `Attach.parse` made of the binding.

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-trace-'));

afterAll(() => { fs.rmSync(directory, { recursive: true }); });

/** Parses a binding with this body (after the `$id`, `title` and `maintainers` every binding has), tracing it. */
async function traced(name: string, body: string): Promise<{ attach: Attach, events: TraceEvent[] }> {
    const file = path.join(directory, `${name}.yaml`);
    fs.writeFileSync(file, `$id: http://devicetree.org/schemas/test/${name}.yaml#\n$schema: http://devicetree.org/meta-schemas/core.yaml#\ntitle: ${name}\nmaintainers: [someone]\n${body}`);
    const events: TraceEvent[] = [];
    const result = await Attach.parse(file, schema_paths, { trace: event => events.push(event) });
    if (Result.is_err(result)) { expect.fail(`${result.error.stage}: ${result.error.message}`); }
    return { attach: result.value, events };
}

const fixups = (events: TraceEvent[], fixup: string) =>
    events.filter((event): event is Extract<TraceEvent, { kind: 'fixup' }> => event.kind === 'fixup' && event.fixup === fixup);

describe('trace', () => {
    test.each(BINDINGS)('tracing $name changes nothing', async ({ path: file }) => {
        const plain = await Attach.parse(file, schema_paths);
        const events: TraceEvent[] = [];
        const tracing = await Attach.parse(file, schema_paths, { trace: event => events.push(event) });

        if (Result.is_err(plain) || Result.is_err(tracing)) { expect.fail('does not parse'); }
        expect(snapshot(tracing.value.parsed_binding)).toBe(snapshot(plain.value.parsed_binding));
        expect(events.length).toBeGreaterThan(0);
    });

    test('the steps come in the order of PARSE_STEPS, the fixup passes within the fixups stage', async () => {
        const { attach, events } = await traced('order', `
allOf:
  - $ref: /schemas/spi/spi-peripheral-props.yaml#
properties:
  compatible:
    const: x,y
  reg:
    maxItems: 1
`);
        const steps = events.flatMap(event =>
            event.kind === 'stage' ? [event.stage] : event.kind === 'pass' ? [`fixups.${event.pass}`] : event.kind === 'translated' ? [event.step] : []);
        const passes = fixup_passes({ names: new Map(), patterns: [] }).map(pass => `fixups.${pass.id}`);
        const ids = PARSE_STEPS.map(step => step.id);
        const fixups_at = ids.indexOf('fixups');
        expect(steps).toStrictEqual([...ids.slice(0, fixups_at), ...passes, ...ids.slice(fixups_at)]);

        const references = events.find(event => event.kind === 'stage' && event.stage === 'references');
        expect(references?.kind === 'stage' && references.refs).toContain('http://devicetree.org/schemas/spi/spi-peripheral-props.yaml#');

        const last_pass = events.filter(event => event.kind === 'pass').at(-1);
        const fixups_stage = events.find(event => event.kind === 'stage' && event.stage === 'fixups');
        expect(last_pass?.kind === 'pass' && last_pass.schema).toStrictEqual(fixups_stage?.kind === 'stage' && fixups_stage.schema);

        const translated = events.filter(event => event.kind === 'translated').at(-1);
        expect(translated?.kind === 'translated' && snapshot(translated.binding)).toBe(snapshot(attach.parsed_binding));
    });

    test('a fixup that changes a property says which, where, and the schema before and after', async () => {
        const { events } = await traced('reg', `
properties:
  reg:
    maximum: 15
`);
        const [reg] = fixups(events, 'reg');
        expect(reg).toMatchObject({ pass: 'walk', target: 'property', pointer: ['properties', 'reg'], name: 'reg' });
        expect(reg?.before).toStrictEqual({ maximum: 15 });
        expect(reg?.after).toMatchObject({ items: [{ items: [{ maximum: 15 }] }] });
    });

    test('the pointer of a oneOf branch has its index, and a fixup that changes nothing is not reported', async () => {
        const { events } = await traced('branches', `
properties:
  clock-names:
    oneOf:
      - items: [{ const: a }]
      - items: [{ const: a }, { const: b }]
`);
        const sized = fixups(events, 'items_size').filter(event => event.name === 'clock-names');
        expect(sized.map(event => event.pointer)).toContainEqual(['properties', 'clock-names', 'oneOf', '1']);
        expect(sized.find(event => event.pointer.at(-1) === '1')?.after).toMatchObject({ minItems: 2, maxItems: 2 });
        for (const event of events) {
            if (event.kind === 'fixup') { expect(event.after).not.toStrictEqual(event.before); }
        }
    });

    test('a node fixup is reported at the node', async () => {
        const { events } = await traced('node', `
properties:
  interrupts:
    maxItems: 1
`);
        const [interrupts] = fixups(events, 'interrupts');
        expect(interrupts).toMatchObject({ target: 'node', pointer: [] });
        expect(interrupts?.after).toHaveProperty(['properties', 'interrupt-parent']);
        expect(interrupts?.before).not.toHaveProperty(['properties', 'interrupt-parent']);
    });
});

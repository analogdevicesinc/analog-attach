import { describe, test, expect } from 'vitest';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import type { Rule, RulesetStruct } from '../../src/ruleset_parser/types';
import { expectErrorContains, expectOk } from '../test_utilities';

// `<include>: {$node: {...}}` constrains the node a plain include points at, the way
// `<union>.<member>: {...}` does for a union member. The plain key alone still means the
// reference itself.

const FIELDS = `
dev: {include: some_device, pointer: true, required: true}
pins: {include: some_pin, pointer: true, count: pins_num}
pins_num: {type: uint8_t}
`;

function parse(body: string) {
    return parse_ruleset(`$type: struct\n$symbol: t\n${FIELDS}$override:\n${body}`);
}

function rules(body: string): Rule[] {
    const parsed = parse(body);
    expectOk(parsed);
    return (parsed.value as RulesetStruct).rules ?? [];
}

describe('$node', () => {
    test('constrains the pointed-at node, reached through the include', () => {
        const [rule] = rules('  - dev:\n      $node:\n        mode: {values: [M1]}\n');
        expect(rule?.effects).toEqual([
            { op: 'restrictValues', reference: { node: 'include', via: ['dev'], property: 'mode' }, values: ['M1'] },
        ]);
    });

    test('$any_of under it is about the pointed-at node too', () => {
        const required = rules('  - dev:\n      $node:\n        $any_of: [cs_gpio, native_cs]\n')
            .flatMap(rule => rule.effects)
            .filter(effect => effect.op === 'setRequired');
        expect(required.map(effect => effect.reference)).toEqual([
            { node: 'include', via: ['dev'], property: 'cs_gpio' },
            { node: 'include', via: ['dev'], property: 'native_cs' },
        ]);
    });

    test('next to it, the other keys still constrain the reference itself', () => {
        const effects = rules('  - dev:\n      required: false\n      $node:\n        mode: {values: [M1]}\n').flatMap(rule => rule.effects);
        expect(effects.map(effect => effect.reference)).toContainEqual({ node: 'self', property: 'dev' });
        expect(effects.map(effect => effect.reference)).toContainEqual({ node: 'include', via: ['dev'], property: 'mode' });
    });

    test('a list is not one node, so it has no $node', () => {
        expectErrorContains(parse('  - pins:\n      $node:\n        mode: {values: [M1]}\n'), 'single include');
    });
});

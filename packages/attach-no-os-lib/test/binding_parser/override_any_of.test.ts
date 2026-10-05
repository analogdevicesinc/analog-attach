import { describe, test, expect } from 'vitest';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import type { Rule, RulesetStruct } from '../../src/ruleset_parser/types';
import { expectErrorContains, expectOk } from '../test_utilities';

// `$any_of`: at least one member must hold. It is a lower bound only - both holding is
// fine - and it lowers to plain rules: when no member holds, every member becomes
// required, with a reason naming them all. No any_of construct survives lowering.

function rules(body: string): Rule[] {
    const parsed = parse_ruleset(`$type: struct\n$symbol: t\n${body}`);
    expectOk(parsed);
    return (parsed.value as RulesetStruct).rules ?? [];
}

const FIELDS = `
cs_gpio: {type: uint8_t}
native_cs: {type: uint16_t}
mode: {type: enum, values: [A, B]}
`;

const REASON = 'needs one of: cs_gpio, native_cs other than 0';

describe('$any_of lowering', () => {
    test('a top-level directive lowers to one rule: none holds -> all required', () => {
        expect(rules(`${FIELDS}$override:\n  - $any_of: [cs_gpio, {native_cs: {not: 0}}]\n`)).toEqual([{
            when: { _t: 'PredicateAnd', predicates: [
                { _t: 'PredicateNot', predicate: { _t: 'PredicateHasValue', reference: { node: 'self', property: 'cs_gpio' } } },
                { _t: 'PredicateNot', predicate: { _t: 'PredicateNoneOf', reference: { node: 'self', property: 'native_cs' }, values: [0] } },
            ] },
            effects: [
                { op: 'setRequired', reference: { node: 'self', property: 'cs_gpio' }, value: true, reason: REASON },
                { op: 'setRequired', reference: { node: 'self', property: 'native_cs' }, value: true, reason: REASON },
            ],
        }]);
    });

    test('inside a $switch case, the case condition is ANDed in front', () => {
        const lowered = rules(`${FIELDS}$override:
  - $switch:
      $on: mode
      $cases:
        A:
          $any_of: [cs_gpio, native_cs]
`);
        // A case holding only the directive contributes no empty rule of its own.
        expect(lowered).toHaveLength(1);
        expect(lowered[0]?.when).toEqual({ _t: 'PredicateAnd', predicates: [
            { _t: 'PredicateEquals', reference: { node: 'self', property: 'mode' }, value: 'A' },
            { _t: 'PredicateNot', predicate: { _t: 'PredicateHasValue', reference: { node: 'self', property: 'cs_gpio' } } },
            { _t: 'PredicateNot', predicate: { _t: 'PredicateHasValue', reference: { node: 'self', property: 'native_cs' } } },
        ] });
    });

    test('a case keeps its own effects as a separate rule', () => {
        const lowered = rules(`${FIELDS}$override:
  - $switch:
      $on: mode
      $cases:
        A:
          cs_gpio: {required: true}
          $any_of: [cs_gpio, native_cs]
`);
        expect(lowered).toHaveLength(2);
        expect(lowered[0]?.effects).toEqual([{ op: 'setRequired', reference: { node: 'self', property: 'cs_gpio' }, value: true }]);
        expect(lowered[1]?.effects.every(effect => effect.op === 'setRequired' && effect.reason !== undefined)).toBe(true);
    });

    test('inside an included-node body, members live on the node at the other end', () => {
        const lowered = rules(`dev: {type: union, members: [{spi_dev: {include: some_device, pointer: true}}]}
$override:
  - dev.spi_dev:
      $any_of: [cs_gpio, {native_cs: {not: 0}}]
`);
        const via = ['dev', 'spi_dev'];
        expect(lowered).toHaveLength(1);
        expect(lowered[0]?.effects.map(effect => effect.reference)).toEqual([
            { node: 'include', via, property: 'cs_gpio' },
            { node: 'include', via, property: 'native_cs' },
        ]);
    });

    test('inside $if/$then, the condition is ANDed in front', () => {
        const lowered = rules(`${FIELDS}$override:
  - $if: {mode: {value: B}}
    $then:
      $any_of: [cs_gpio, native_cs]
`);
        expect(lowered).toHaveLength(1);
        const when = lowered[0]?.when;
        expect(when?._t === 'PredicateAnd' && when.predicates[0]).toEqual(
            { _t: 'PredicateEquals', reference: { node: 'self', property: 'mode' }, value: 'B' }
        );
    });
});

describe('$any_of authoring errors', () => {
    test('fewer than two entries is refused', () => {
        expectErrorContains(parse_ruleset(`$type: struct\n$symbol: t\n${FIELDS}$override:\n  - $any_of: [cs_gpio]\n`), 'at least 2 entries');
    });

    test('an unknown property is refused in this node\'s own scope', () => {
        expectErrorContains(parse_ruleset(`$type: struct\n$symbol: t\n${FIELDS}$override:\n  - $any_of: [cs_gpio, nope]\n`), "Unknown property 'nope'");
    });

    test('a condition entry must name exactly one property', () => {
        expectErrorContains(
            parse_ruleset(`$type: struct\n$symbol: t\n${FIELDS}$override:\n  - $any_of: [cs_gpio, {native_cs: {not: 0}, mode: {value: A}}]\n`),
            'exactly one property'
        );
    });

    test('it must be a list', () => {
        expectErrorContains(parse_ruleset(`$type: struct\n$symbol: t\n${FIELDS}$override:\n  - $any_of: cs_gpio\n`), 'must be an array');
    });
});

describe('the not: condition operator', () => {
    test('lowers to "set, and none of these"', () => {
        const lowered = rules(`${FIELDS}$override:\n  - $if: {native_cs: {not: [0, 1]}}\n    $then: {cs_gpio: {required: true}}\n`);
        expect(lowered[0]?.when).toEqual({ _t: 'PredicateNoneOf', reference: { node: 'self', property: 'native_cs' }, values: [0, 1] });
    });
});

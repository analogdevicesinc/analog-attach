import { describe, test, expect } from 'vitest';
import { parse_ruleset } from '../src/ruleset_parser/ruleset_parser';
import { RulesetType } from '../src/ruleset_parser/types';
import { expectErrorContains, expectOk } from './test_utilities';

// The ruleset header: what every kind must declare, and what it must not have to.
//
// A ruleset describes one C symbol and nothing else. Build facts - which Kconfig symbol
// turns the code on, which .c files compile it - belong to the module that ships the
// symbol, so they are read from its module.yml and are absent here.

describe('ruleset header', () => {
    test('a struct needs only its type, symbol and members', () => {
        const parsed = parse_ruleset(`$type: struct\n$symbol: thing\nfield: {type: uint8_t}\n`);
        expectOk(parsed);
        expect(parsed.value.$symbol).toBe('thing');
        expect(parsed.value.$type).toBe(RulesetType.RT_STRUCT);
        expect(parsed.value.$description).toBe('ruleset');
    });

    test('$type is required', () => {
        expectErrorContains(parse_ruleset(`$symbol: thing\n`), "Missing required field '$type'");
    });

    test('$symbol is required, because it is the identity', () => {
        // `include:` and a workfile's `$compatible` both name this, and the registry keys
        // on it; a ruleset without one cannot be referenced at all.
        expectErrorContains(parse_ruleset(`$type: struct\n`), "Missing required field '$symbol'");
    });

    test('an unknown $type is refused', () => {
        expectErrorContains(parse_ruleset(`$type: nonsense\n$symbol: thing\n`), "Invalid ruleset type 'nonsense'");
    });

    test('each kind parses to its own shape', () => {
        const enum_ = parse_ruleset(`$type: enum\n$symbol: e\nvalues: {A: "a"}\n`);
        expectOk(enum_);
        expect(enum_.value._t).toBe('RulesetEnum');

        const extern = parse_ruleset(`$type: extern\n$symbol: x\n$provides: some_type\n`);
        expectOk(extern);
        expect(extern.value._t).toBe('RulesetExtern');

        const descriptor = parse_ruleset(
            `$type: descriptor\n$symbol: d\n$init_function: d_init\n$remove_function: d_deinit\n` +
            `$init_param: {include: some_config, pointer: true}\n`
        );
        expectOk(descriptor);
        expect(descriptor.value._t).toBe('RulesetDescriptor');
    });

    test('a descriptor names the functions that bring it up', () => {
        // The function names are the data; whether a target renders the call generically or
        // through a template is the target's business.
        const missing = parse_ruleset(
            `$type: descriptor\n$symbol: d\n$init_param: {include: some_config}\n`
        );
        expectErrorContains(missing, "Missing required field '$init_function'");
    });

    test('a template is optional, and overrides the generic rendering', () => {
        const parsed = parse_ruleset(
            `$type: descriptor\n$symbol: d\n$init_function: d_init\n$remove_function: d_deinit\n` +
            `$init_template: init.eta\n$remove_template: remove.eta\n` +
            `$init_param: {include: some_config}\n`
        );
        expectOk(parsed);
        if (parsed.value._t !== 'RulesetDescriptor') { throw new Error('expected a descriptor'); }
        expect(parsed.value.$init_template).toBe('init.eta');
    });

    test('an extern must say what type it provides', () => {
        // An extern matches an `include:` on `$provides`, not on its own symbol: `$symbol`
        // is the name of the global, `$provides` the type it has.
        expectErrorContains(
            parse_ruleset(`$type: extern\n$symbol: x\n`),
            "Missing required field '$provides'"
        );
    });

    test('an unknown $-prefixed key is ignored, not refused', () => {
        // These files are owned by other repos and gain keys without asking us; a key this
        // version does not read must not stop it loading.
        const parsed = parse_ruleset(`$type: struct\n$symbol: thing\n$future_key: 1\nfield: {type: uint8_t}\n`);
        expectOk(parsed);
    });
});

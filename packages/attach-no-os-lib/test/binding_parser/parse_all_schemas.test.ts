import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { all_symbols } from '../../src/registry/registry';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import fs from 'node:fs';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// Every ruleset the configured module roots declare must parse on its own and resolve with
// its neighbours. This used to walk a sibling no-OS checkout through a symlink, so it only
// ran on one machine; it now walks the fixture ecosystem, which is checked in.
//
// Resolution is the half that matters most: it follows each `include:` by bare symbol, so a
// reference that reaches from one module into another is exercised here and nowhere else.

describe('every declared ruleset', () => {
    beforeAll(() => { setup_test_config(); });
    afterAll(() => { teardown_test_config(); });

    test('the index is not silently empty', () => {
        // Guards the rest of this file: if the roots failed to load, each case below would
        // pass by having nothing to check.
        const entries = all_symbols();
        expectOk(entries);
        expect(entries.value.length).toBeGreaterThan(0);
    });

    test('parses and resolves', () => {
        const entries = all_symbols();
        expectOk(entries);

        for (const entry of entries.value) {
            const parsed = parse_ruleset(fs.readFileSync(entry.file, 'utf8'));
            if (!parsed.ok) {
                expect.fail(`${entry.$symbol} (${entry.file}) failed to parse: ${parsed.error.message}`);
            }

            const resolved = load_resolved_ruleset(entry.$symbol);
            if (!resolved.ok) {
                expect.fail(`${entry.$symbol} failed to resolve: ${resolved.error.message}`);
            }
        }
    });

    test('each symbol reports the identity its file declares', () => {
        const entries = all_symbols();
        expectOk(entries);

        for (const entry of entries.value) {
            const resolved = load_resolved_ruleset(entry.$symbol);
            expectOk(resolved);
            expect(resolved.value.$symbol).toBe(entry.$symbol);
            expect(resolved.value.$type).toBe(entry.$type);
        }
    });
});

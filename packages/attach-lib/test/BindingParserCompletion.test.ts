import path from 'node:path';
import * as fs from 'node:fs';

import { Attach, DeviceTree, is_open, populate_binding } from 'attach-lib';
import type { ParsedBinding } from 'attach-lib';
import { Result } from '../src/result.js';
import { write_to_directory } from './testing_utils';

import { beforeAll, describe, expect, test } from 'vitest';

// Parses and populates the whole Linux bindings tree (about 40s), so it only runs on demand:
//   BINDING_CORPUS=1 yarn test test/BindingParserCompletion.test.ts
// Both tests read the processed schema of the Linux tree when there is one; PROCESSED_SCHEMA=<file> names another, PROCESSED_SCHEMA= none.
// The pass/fail baseline is corpus/bindings.json (`yarn corpus` rewrites it); the reports
// land in test/expected/cache/ (gitignored).
const run = process.env.BINDING_CORPUS === '1';

const linux_path = path.resolve(__dirname, 'linux');
const dt_schema_path = path.resolve(__dirname, 'dt-schema');
const bindings_path = path.join(linux_path, 'Documentation/devicetree/bindings');
const baseline_path = path.resolve(__dirname, '../corpus/bindings.json');
const dts_path = path.resolve(__dirname, 'dts_source/rpi.prepro.dts');
const report_path = path.resolve(__dirname, 'expected/cache');
// The output of `dt-mk-schema -j` over the trees (see scripts/processed-schema.mjs), when there is one: the property types of every schema
const processed_schema_path = process.env.PROCESSED_SCHEMA ?? path.join(bindings_path, 'processed-schema.json');
const processed_schema = processed_schema_path !== '' && fs.existsSync(processed_schema_path) ? processed_schema_path : undefined;
const schema_paths = { linux: linux_path, dt_schema: dt_schema_path, ...(processed_schema === undefined ? {} : { processed_schema }) };

type Parsed = { name: string, binding: ParsedBinding };
type Failure = { name: string, stage: string, message: string };

function* walk(directory: string): Generator<string> {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entry_path = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walk(entry_path);
        } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
            yield entry_path;
        }
    }
}

function count_by<T>(items: T[], key: (item: T) => string): [string, number][] {
    const counts = new Map<string, number>();
    for (const item of items) {
        counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
}

function print_table(title: string, rows: [string, number][], limit = 10) {
    console.log(`${title}\n${rows.slice(0, limit).map(([key, count]) => `  ${String(count).padStart(5)}  ${key}`).join('\n')}`);
}

// Populates each binding for the rpi-4-b devicetree: the property keys must survive, and the
// properties that stay unknown or open are reported (and written to test/expected/cache/<label>_*.json).
function populate_for_rpi(label: string, parsed: Parsed[]) {
    const document = DeviceTree.new_from_string(fs.readFileSync(dts_path, 'utf8'));
    if (typeof document === 'string') {
        throw new TypeError(`Failed to parse rpi.prepro.dts: ${document}`);
    }

    const unknown: { binding: string, property: string }[] = [];
    const open: { binding: string, property: string }[] = [];
    let fully_typed = 0;

    for (const { name, binding } of parsed) {
        const populated = populate_binding(binding, document, '{}', { parent_name: 'spi@7e204000' });

        expect(populated.properties.map(property => property.key), name).toEqual(binding.properties.map(property => property.key));

        const properties = [...populated.properties, ...(populated.pattern_properties ?? []).flatMap(pattern => pattern.properties)];
        const unknown_here = properties.filter(property => property.value._t === 'unknown');
        const open_here = properties.filter(property => is_open(property.value));

        unknown.push(...unknown_here.map(property => ({ binding: name, property: property.key })));
        open.push(...open_here.map(property => ({ binding: name, property: property.key })));
        if (unknown_here.length === 0 && open_here.length === 0) {
            fully_typed++;
        }
    }

    const directory = (item: { binding: string }) => item.binding.split('/')[0] ?? item.binding;

    console.log(`Fully typed: ${fully_typed} out of ${parsed.length} parsed bindings`);
    print_table('Unknown properties by directory:', count_by(unknown, directory));
    print_table('Open lists by directory:', count_by(open, directory));
    print_table('Most common unknown properties:', count_by(unknown, item => item.property));
    print_table('Most common open lists:', count_by(open, item => item.property));
    write_to_directory(report_path, `${label}_unknown_properties`, unknown);
    write_to_directory(report_path, `${label}_open_lists`, open);
}

describe.runIf(run && fs.existsSync(bindings_path) && fs.existsSync(dt_schema_path))('Binding corpus', () => {

    const parsed: Parsed[] = [];
    const failures: Failure[] = [];
    let binding_count = 0;

    beforeAll(async () => {
        for (const file of walk(bindings_path)) {
            binding_count++;
            const name = path.relative(bindings_path, file);
            const result = await Attach.parse(file, schema_paths);

            if (Result.is_err(result)) {
                failures.push({ name, stage: result.error.stage, message: result.error.message });
            } else {
                parsed.push({ name, binding: result.value.parsed_binding });
            }
        }
    }, 300_000);

    test('no binding that parsed in the baseline fails now', () => {
        const baseline: { bindings: Record<string, string> } = JSON.parse(fs.readFileSync(baseline_path, 'utf8'));
        const failed_before = new Set(Object.entries(baseline.bindings).filter(([, entry]) => entry.startsWith('!')).map(([name]) => name));

        const regressions = failures.filter(failure => !failed_before.has(failure.name));
        const fixed = parsed.filter(({ name }) => failed_before.has(name));

        console.log(`Parsed ${parsed.length} out of ${binding_count} (baseline: ${binding_count - failed_before.size})`);
        print_table('Failures by stage:', count_by(failures, failure => failure.stage));
        print_table('Failures by message:', count_by(failures, failure => `${failure.stage}: ${failure.message.replaceAll(linux_path, '<linux>').replaceAll(dt_schema_path, '<dt-schema>').slice(0, 100)}`));
        if (fixed.length > 0) {
            console.log(`${fixed.length} bindings failed in the baseline and parse now: run \`yarn corpus\` to accept`);
        }
        write_to_directory(report_path, 'failed_to_parse_bindings', failures);

        expect(regressions.map(({ name, stage, message }) => `${name} (${stage}): ${message.slice(0, 200)}`)).toEqual([]);
    });

    test('populating every binding for rpi-4-b keeps its properties and reports what stays untyped', () => {
        populate_for_rpi('corpus', parsed);
    }, 300_000);
});

// Small enough to run from the editor's test panel, without BINDING_CORPUS.
describe.runIf(fs.existsSync(bindings_path) && fs.existsSync(dt_schema_path))('IIO bindings for rpi-4-b', () => {

    test('populating every iio binding keeps its properties and reports what stays untyped', async () => {
        const parsed: Parsed[] = [];

        for (const file of walk(path.join(bindings_path, 'iio'))) {
            const result = await Attach.parse(file, schema_paths);
            if (Result.is_ok(result)) {
                parsed.push({ name: path.relative(bindings_path, file), binding: result.value.parsed_binding });
            }
        }

        expect(parsed.length).toBeGreaterThan(0);
        populate_for_rpi('iio', parsed);
    }, 120_000);
});

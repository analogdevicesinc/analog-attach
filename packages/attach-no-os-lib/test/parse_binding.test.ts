import * as fs from 'node:fs';
import path from 'node:path';

import { parse_binding } from '../src/bindings_parser/binding_parser';

import { test, expect } from 'vitest';
import { Binding } from '../src/bindings_parser/types';
import { ok } from '../src/bindings_parser/result';

test('parse basic binding', () => {
	const source_path = path.resolve(__dirname, 'bindings/adxl355.yaml');
	const source = fs.readFileSync(source_path, 'utf8');

	const result = parse_binding(source);
	console.error(result);
	expect(result).toMatchObject({ ok: true });
	// console.log(result);

	// const expected_path = path.resolve(__dirname, 'expected/adxl355.json');
	// const expected = JSON.parse(fs.readFileSync(expected_path, 'utf8'));
	//
	// expect(result).toStrictEqual(expected);
});

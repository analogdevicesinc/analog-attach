import fs from 'node:fs';
import path from 'node:path';
import { parse_ruleset } from '../src/ruleset_parser/ruleset_parser';
import { test } from 'vitest';
import { expectOk } from './test_utilities';

test('parse adxl355 ruleset', () => {
	const source_path = path.resolve(__dirname, 'bindings/schemas/devices/adi,adxl355.yaml');
	const source = fs.readFileSync(source_path, 'utf8');

	const result = parse_ruleset(source);
	expectOk(result);
});

test('parse max_spi_init_param ruleset', () => {
	const source_path = path.resolve(__dirname, 'bindings/schemas/platforms/maxim/max32690/max_spi_init_param.yaml');
	const source = fs.readFileSync(source_path, 'utf8');

	const result = parse_ruleset(source);
	expectOk(result);
});

test('parse ad5592r ruleset', () => {
	const source_path = path.resolve(__dirname, 'bindings/schemas/devices/adi,ad5592r.yaml');
	const source = fs.readFileSync(source_path, 'utf8');
	const result = parse_ruleset(source);
	expectOk(result);
});

test('parse xil_spi_init_param ruleset', () => {
	const source_path = path.resolve(__dirname, 'bindings/schemas/platforms/xilinx/xil_spi_init_param.yaml');
	const source = fs.readFileSync(source_path, 'utf8');
	const result = parse_ruleset(source);
	expectOk(result);
});

test('parse ad5592r_channel_mode enum binding', () => {
	const source_path = path.resolve(__dirname, 'bindings/schemas/devices/ad5592r-enums/ad5592r_channel_mode.yaml');
	const source = fs.readFileSync(source_path, 'utf8');
	const result = parse_ruleset(source);
	expectOk(result);
});

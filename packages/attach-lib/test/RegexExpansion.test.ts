import { expand_regex, expand_pattern } from '../src/RegexExpansion.js';

import { describe, test, expect } from 'vitest';

test('/^in(?:[13579]|1[135])-supply$/', () => {
	const expanded = expand_regex(/^in(?:[13579]|1[135])-supply$/);
	const expected = ["in1-supply", "in3-supply", "in5-supply", "in7-supply", "in9-supply", "in11-supply", "in13-supply", "in15-supply"];

	expect(expanded).toStrictEqual(expected);
});

test('/^in(?:9|1[135])-supply$/', () => {
	const expanded = expand_regex(/^in(?:9|1[135])-supply$/);
	const expected = ["in9-supply", "in11-supply", "in13-supply", "in15-supply"];

	expect(expanded).toStrictEqual(expected);
});

test('/^channel@[0-9a-f]$/', () => {
	const expanded = expand_regex(/^channel@[0-9a-f]$/);
	const expected = ["channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7", "channel@8", "channel@9", "channel@a", "channel@b", "channel@c", "channel@d", "channel@e", "channel@f"];

	expect(expanded).toStrictEqual(expected);
});

test('/^channel@[0-7]$/', () => {
	const expanded = expand_regex(/^channel@[0-7]$/);
	const expected = ["channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7"];

	expect(expanded).toStrictEqual(expected);
});

test('/^channel@[8-9a-f]$/', () => {
	const expanded = expand_regex(/^channel@[8-9a-f]$/);
	const expected = ["channel@8", "channel@9", "channel@a", "channel@b", "channel@c", "channel@d", "channel@e", "channel@f"];

	expect(expanded).toStrictEqual(expected);
});

test('/^(channel@)[0-7]$/', () => {
	const expanded = expand_regex(/^(channel@)[0-7]$/);
	const expected = ["channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7"];

	expect(expanded).toStrictEqual(expected);
});

test('/dev@[0-3]/', () => {
	const expanded = expand_regex(/dev@[0-3]/);
	const expected = ["dev@0", "dev@1", "dev@2", "dev@3"];

	expect(expanded).toStrictEqual(expected);
});

test('^buck[12]$', () => {
	const expanded = expand_regex(/^buck[12]$/);
	const expected = ["buck1", "buck2"];

	expect(expanded).toStrictEqual(expected);
});

test('^channel@([0-9]|1[0-5])$', () => {
	const expanded = expand_regex(/^channel@([0-9]|1[0-5])$/);
	const expected = ["channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7", "channel@8", "channel@9", "channel@10", "channel@11", "channel@12", "channel@13", "channel@14", "channel@15"];

	expect(expanded).toStrictEqual(expected);
});

test('^channel@([0-1])$', () => {
	const expanded = expand_regex(/^channel@([0-1])$/);
	const expected = ["channel@0", "channel@1"];

	expect(expanded).toStrictEqual(expected);
});

test('^channel(@[0-9])?$ — the optional group can be left out', () => {
	const expanded = expand_regex(/^channel(@[0-9])?$/);
	const expected = ["channel", "channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7", "channel@8", "channel@9"];

	expect(expanded).toStrictEqual(expected);
});

describe('expand_pattern — binding patterns into names, or the literal stem when unbounded', () => {
	const names = (n: number, f: (index: number) => string): string[] => Array.from({ length: n }, (_, index) => f(index));

	test.each([
		['^channel@([0-9]|1[0-5])$', names(16, index => `channel@${index}`)],
		['^adi,bypass-attenuator-in[0-4]$', names(5, index => `adi,bypass-attenuator-in${index}`)],
		['^vdd-s[1-8]-supply$', names(8, index => `vdd-s${index + 1}-supply`)],
		['^adi,pin(5|10)-function$', ['adi,pin5-function', 'adi,pin10-function']],
		['^(channel@)[0-7]$', names(8, index => `channel@${index}`)],
		['^in\\d$', names(10, index => `in${index}`)],
		['^a[01]{2}$', ['a00', 'a01', 'a10', 'a11']],
		['^gpio\\.cfg$', ['gpio.cfg']],
	])('%s', (pattern, expected) => {
		expect(expand_pattern(pattern)).toStrictEqual({ names: expected });
	});

	test('nested groups', () => {
		expect(expand_pattern('^clk-phase-(legacy|sd-hs|mmc-(hs|hs[24]00|ddr52)|uhs-(sdr(12|25|50|104)|ddr50))$')).toStrictEqual({
			names: ['legacy', 'sd-hs', 'mmc-hs', 'mmc-hs200', 'mmc-hs400', 'mmc-ddr52', 'uhs-sdr12', 'uhs-sdr25', 'uhs-sdr50', 'uhs-sdr104', 'uhs-ddr50']
				.map(name => `clk-phase-${name}`),
		});
	});

	test.each([
		['^fan-[0-9]+$', 'fan-'],
		['^usb@[0-9a-f]+$', 'usb@'],
		['^opp-table(-[a-z0-9]+)?$', 'opp-table'],
		['.*-supply$', ''],
		['^[^@]+$', ''],
		// More than the cap: 38 names
		['^LDO([1-9]|[1-2][0-9]|3[0-8])$', 'LDO'],
		['^reg@[0-9a-f]{8}$', 'reg@'],
	])('%s → stem %j', (pattern, stem) => {
		expect(expand_pattern(pattern)).toStrictEqual({ stem });
	});

	test('the cap can be raised', () => {
		expect(expand_pattern('^LDO([1-9]|[1-2][0-9]|3[0-8])$', 64)).toStrictEqual({ names: names(38, index => `LDO${index + 1}`) });
	});
});

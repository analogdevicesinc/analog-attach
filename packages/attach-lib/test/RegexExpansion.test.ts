import { expand_regex } from 'attach-lib';

import { test, expect } from 'vitest';

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

test('^channel(@[0-9])?$', () => {
	const expanded = expand_regex(/^channel(@[0-9])?$/);
	const expected = ["channel@0", "channel@1", "channel@2", "channel@3", "channel@4", "channel@5", "channel@6", "channel@7", "channel@8", "channel@9"];

	//expect(expanded).toStrictEqual(expected);
});
import { expect } from 'vitest';
import { Result } from '../src/bindings_parser/result';

export function expectOk<T>(result: Result<T>): asserts result is { ok: true; value: T } {
	if (!result.ok) {
		expect.fail(`Expected ok but got error:\n${JSON.stringify(result.error, null, 2)}`);
	}
}

export function expectError<T>(result: Result<T>): asserts result is { ok: false; error: { message: string; path: string } } {
	if (result.ok) {
		expect.fail(`Expected error but got ok:\n${JSON.stringify(result.value, null, 2)}`);
	}
}


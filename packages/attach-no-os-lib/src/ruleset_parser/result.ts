import type { ErrorType } from "./error_types";

export interface ResultError {
	message: string,
	/** Which kind of error it is (GEN-17), whatever the message says. */
	type: ErrorType,
	path?: string
}

export type Result<T> =
	| { ok: true;  value: T }
	| { ok: false; error: ResultError }

export function ok<T = void>(value?: T): Result<T> {
	return { ok: true, value: value as T };
}

export function error(message: string, type: ErrorType, path?: string): Result<never> {
	return { ok: false, error: { message, type, path } };
}


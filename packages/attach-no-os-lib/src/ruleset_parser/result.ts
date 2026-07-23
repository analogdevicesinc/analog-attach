export interface ResultError {
	message: string,
	path?: string
}

export type Result<T> =
	| { ok: true;  value: T }
	| { ok: false; error: ResultError }

export function ok<T = void>(value?: T): Result<T> {
	return { ok: true, value: value as T };
}

export function error(message: string, path?: string): Result<never> {
	return { ok: false, error: { message, path } };
}


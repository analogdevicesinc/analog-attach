export type BindingError = {
	_t: "BindingError",
	message: string,
	path: string
}

export type Result<T, E = BindingError> =
	| { ok: true;  value: T }
	| { ok: false; error: E }

export function ok<T = void>(value?: T): Result<T> {
	return { ok: true, value: value as T };
}

export function error(message: string, path: string): Result<never> {
	return { ok: false, error: { "_t": "BindingError", message, path } };
}


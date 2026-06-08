export type OK<T> = {
  readonly kind: "ok";
  value: T;
}

export type Error<E> = {
  readonly kind: "error";
  error: E;
}

export type Result<T, E> =
  | OK<T>
  | Error<E>;

export const Result = {
  Ok: <T, E = never>(value: T): Result<T, E> => ({ kind: "ok", value }) as const,
  Err: <T = never, E = unknown>(error: E): Result<T, E> => ({ kind: "error", error }) as const,

  is_ok: <T, E>(r: Result<T, E>): r is OK<T> => r.kind === "ok" as const,
  is_err: <T, E>(r: Result<T, E>): r is Error<E> => !Result.is_ok(r),
} as const;

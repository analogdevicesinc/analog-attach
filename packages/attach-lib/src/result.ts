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
  ok: <T, E = never>(value: T): Result<T, E> => ({ kind: "ok", value }) as const,
  error: <T = never, E = unknown>(error: E): Result<T, E> => ({ kind: "error", error }) as const,

  isOk: <T, E>(r: Result<T, E>): r is OK<T> => r.kind === "ok" as const,
  isError: <T, E>(r: Result<T, E>): r is Error<E> => r.kind === "error" as const,
} as const;

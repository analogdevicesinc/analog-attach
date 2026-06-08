export type Valid<T> = T extends null | undefined
  ? never
  : T;

export type Some<T> = {
  readonly kind: "some";
  value: Valid<T>;
}

export type None = {
  readonly kind: "none";
}

export type Option<T> =
  | Some<T>
  | None;

export const Option = {
  Some: <T>(value: Valid<T>): Option<T> => ({ kind: "some", value }) as const,
  None: <T = never>(): Option<T> => ({ kind: "none" }) as const,

  unwrap: <T>(o: Option<T>): T => {
    if (o.kind !== "some") {
      throw new Error("Tried to unwrap None");
    }
    return o.value;
  },
  unwrap_or: <T>(o: Option<T>, fallback_value: T): T => {
    return o.kind === "some" ? o.value : fallback_value;
  },

  is_none: <T>(o: Option<T>): o is None => o.kind === "none",
  is_some: <T>(o: Option<T>): o is Some<T> => !Option.is_none(o),
} as const;

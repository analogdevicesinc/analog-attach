export type AddCallOnce<
    Base,
    CallOnce,
    Remaining extends keyof CallOnce = keyof CallOnce
> = Base & {
    [K in Remaining]: CallOnce[K] extends (...arguments_: infer A) => unknown
    ? (...arguments_: A) => AddCallOnce<Base, CallOnce, Exclude<Remaining, K>>
    : never;
};

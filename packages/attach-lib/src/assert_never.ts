export function assert_never(_: never): never {
    throw new Error("Didn't expect to get here");
}

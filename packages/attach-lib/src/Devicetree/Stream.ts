export class Stream<T, P = never> implements Iterable<[P] extends [never] ? T : [T, P]> {
    constructor(private iterable: Iterable<[P] extends [never] ? T : [T, P]>) { }

    [Symbol.iterator]() {
        return this.iterable[Symbol.iterator]();
    }

    filter(predicate: (value: T, path: P) => boolean): Stream<T, P> {
        // eslint-disable-next-line unicorn/no-this-assignment
        const self = this;

        return new Stream<T, P>(
            (function* () {
                for (const item of self) {
                    if (Array.isArray(item)) {
                        const [value, path] = item as [T, P];
                        if (predicate(value, path)) {
                            yield item;
                        }
                    } else {
                        if (predicate(item as T, undefined as P)) {
                            yield item;
                        }
                    }
                }
            })()
        );
    }

    toArray(): ([P] extends [never] ? T : [T, P])[] {
        return [...this];
    }
}
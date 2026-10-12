export class Stream<T> implements Iterable<T> {
    constructor(private iterable: Iterable<T>) { }

    [Symbol.iterator]() {
        return this.iterable[Symbol.iterator]();
    }

    filter(predicate: (value: T) => boolean): Stream<T> {
        // eslint-disable-next-line unicorn/no-this-assignment
        const self = this;

        return new Stream<T>(
            (function* () {
                for (const item of self) {
                    if (predicate(item)) {
                        yield item;
                    }
                }
            })()
        );
    }

    toArray(): T[] {
        return [...this];
    }
}

export type Labeled<T> = {
    payload: T,
    labels: string[]
};

export function is_labeled<T>(object: any): object is Labeled<T> {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    if (!("payload" in object)) {
        return false;
    }

    if (object.payload === undefined) {
        return false;
    }

    if (!("labels" in object)) {
        return false;
    }

    if (!Array.isArray(object.labels)) {
        return false;
    }

    if (Object.entries(object).length > 2) {
        return false;
    }

    const narrowed = object as Labeled<T>;

    if (!narrowed.labels.every((entry) => typeof entry === 'string')) {
        return false;
    }

    return true;
}

export function make_labeled<T>(object: T, labels?: string[]): Labeled<T> {

    type Labeled_T = Labeled<T>;
    const labeled_object: Labeled_T = {
        payload: object,
        labels: labels ?? []
    };

    return labeled_object;
}

export function make_labeled_iterable<U>(object: Labeled<Iterable<U>>): Iterable<U> {
    return {
        *[Symbol.iterator]() {
            for (const item of object.payload) {
                yield item;
            }
        }
    };
}

export type MakeArray<T> = T[];

export function is_array<T>(object: any): object is MakeArray<T> {
    if (object === null || typeof object !== 'object') {
        return false;
    }

    if (!Array.isArray(object)) {
        return false;
    }

    return true;
}

export function make_array<T>(object: T): MakeArray<T> {
    type Array_T = MakeArray<T>;
    const object_array: Array_T = [object];

    return object_array;
}

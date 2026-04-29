import { PathEntry, PathValue, PlainObject } from "./UtilityTypes.js";

export function is_plain_object(value: unknown): value is PlainObject {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

export function find_in_object(
    object: unknown,
    pred: (path: string[], value: unknown) => boolean
): PathValue[] {

    const results: PathValue[] = [];
    const stack: Array<{ value: unknown; path: string[] }> = [
        { value: object, path: [] }
    ];

    while (stack.length > 0) {
        const { value, path } = stack.pop()!;

        if (Array.isArray(value)) {
            // Push in reverse order to preserve original traversal order
            for (let index = value.length - 1; index >= 0; index--) {
                stack.push({
                    value: value[index],
                    path: [...path, String(index)]
                });
            }
        } else if (value !== null && typeof value === "object") {
            const entries = Object.entries(value);
            // Reverse to preserve the same order as recursion
            for (let index = entries.length - 1; index >= 0; index--) {
                const [key, child] = entries[index];
                stack.push({
                    value: child,
                    path: [...path, key]
                });
            }
        } else {
            if (pred(path, value)) {
                results.push({ path, value });
            }
        }
    }

    return results;
}

export function find_entry_in_object(
    object: unknown,
    pred: (path: string[], key: string, value: unknown) => boolean,
    path: string[] = []
): PathEntry[] {
    const results: PathEntry[] = [];

    type StackItem = {
        value: unknown;
        path: string[];
    };

    const stack: StackItem[] = [{ value: object, path }];

    while (stack.length > 0) {
        const { value, path } = stack.pop()!;

        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index--) {
                const entryValue = value[index];
                const key = String(index);

                // Check entry (index → value)
                if (pred(path, key, entryValue)) {
                    results.push({ path, key, value: entryValue });
                }

                // Push child for later processing
                stack.push({
                    value: entryValue,
                    path: [...path, key],
                });
            }
        } else if (value !== null && typeof value === "object") {
            const entries = Object.entries(value);

            // Iterate in reverse to preserve traversal order
            for (let index = entries.length - 1; index >= 0; index--) {
                const [key, entryValue] = entries[index];

                // Check entry (key → value)
                if (pred(path, key, entryValue)) {
                    results.push({ path, key, value: entryValue });
                }

                // Push child for later processing
                stack.push({
                    value: entryValue,
                    path: [...path, key],
                });
            }
        }
    }

    return results;
}

export function overwrite_object_with_path_value<T extends Record<string, any>>(
    target: T,
    updates: PathValue[]
): T {
    const cloneDeep = (object: any): any => {
        if (object === null || typeof object !== "object") { return object; }
        if (Array.isArray(object)) { return object.map((element) => cloneDeep(element)); }
        const result: any = {};
        for (const key of Object.keys(object)) {
            result[key] = cloneDeep(object[key]);
        }
        return result;
    };

    const setByPath = (object: any, path: string[], value: unknown): any => {
        if (path.length === 0) { return object; }
        const [key, ...rest] = path;

        // Clone the current level to preserve immutability
        const newObject = Array.isArray(object) ? [...object] : { ...object };

        if (rest.length === 0) {
            newObject[key] = value;
        } else {
            const currentValue = object?.[key];
            newObject[key] = setByPath(
                typeof currentValue === "object" && currentValue !== null
                    ? currentValue
                    : {},
                rest,
                value
            );
        }

        return newObject;
    };

    // Deep clone the target before merging
    let result = cloneDeep(target);

    for (const { path, value } of updates) {
        result = setByPath(result, path, value);
    }

    return result;
}

export function map_object(
    object: unknown,
    function_: (path: string[], value: unknown) => unknown,
    path: string[] = []
): unknown {
    if (Array.isArray(object)) {
        return object.map((item, index) => map_object(item, function_, [...path, String(index)]));
    } else if (object !== null && typeof object === "object") {
        return Object.fromEntries(
            Object.entries(object).map(([k, v]) => [k, map_object(v, function_, [...path, k])])
        );
    } else {
        return function_(path, object);
    }
}

export function compare_arrays(a: string[], b: string[]) {
    return a.length === b.length && a.every((element, index) => element === b[index]);
}

export function deep_merge<T, U>(target: T, source: U): T & U {
    // If source is an array, just return it
    if (Array.isArray(source)) {
        return source as unknown as T & U;
    }

    // If target is an array but source is not, replace with source
    if (Array.isArray(target)) {
        return source as unknown as T & U;
    }

    // If both are objects, merge recursively
    if (is_plain_object(target) && is_plain_object(source)) {
        const result: PlainObject = { ...target };

        for (const key of Object.keys(source)) {
            const sValue = source[key];
            const tValue = (target as PlainObject)[key];

            result[key] = deep_merge(tValue, sValue);
        }

        return result as T & U;
    }

    // Fallback: primitive values or mismatched types
    return source as T & U;
}

export function delete_path<T extends Record<string, any>>(object: T, paths: string[][]): T {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function deletePath(current: any, path: string[]): any {
        if (path.length === 0 || current === undefined || typeof current !== "object") {
            return current;
        }

        const [key, ...rest] = path;

        if (!(key in current)) { return current; } // path not found, leave unchanged

        if (rest.length === 0) {
            // delete key at this level — shallow clone first
            if (Array.isArray(current)) {
                const index = Number(key);
                if (Number.isNaN(index)) { return current; } // invalid index
                return current.filter((_, index_) => index_ !== index);
            } else {
                const { [key]: _, ...clone } = current;
                return clone;
            }
        }

        const updated = deletePath(current[key], rest);

        // If nothing changed, return same reference
        if (updated === current[key]) { return current; }

        // Shallow clone preserving arrays
        if (Array.isArray(current)) {
            const clone = [...current];
            const index = Number(key);
            if (!Number.isNaN(index)) { clone[index] = updated; }
            return clone;
        } else {
            return { ...current, [key]: updated };
        }
    }

    let result: any = object;

    for (const path of paths) {
        result = deletePath(result, path);
    }

    return result;
}

export function getByPath<T extends object, R = unknown>(
    object: T,
    path: string[]
): R | undefined {
    // eslint-disable-next-line unicorn/no-array-reduce
    return path.reduce<any>((accumulator, key) => {
        if (accumulator && typeof accumulator === "object" && key in accumulator) {
            return accumulator[key];
        }
        return;
    }, object);
}

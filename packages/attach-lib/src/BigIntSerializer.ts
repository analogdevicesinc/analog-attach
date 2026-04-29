/**
 * BigInt Serialization Utilities
 * 
 * Provides functions to serialize and deserialize objects containing BigInt values
 * for JSON transmission (e.g., via postMessage).
 * 
 * BigInt values are converted to objects with the shape: { $type: "BigInt", value: "string" }
 * This allows them to be safely stringified and later reconstructed.
 */

interface BigIntWrapper {
    $type: "BigInt";
    value: string;
}

function isBigIntWrapper(value: unknown): value is BigIntWrapper {
    return (
        typeof value === "object" &&
        value !== null &&
        "$type" in value &&
        (value as Record<string, unknown>)["$type"] === "BigInt" &&
        "value" in value &&
        typeof (value as Record<string, unknown>)["value"] === "string"
    );
}

/**
 * Recursively serialize an object, converting BigInt values to wrapper objects.
 * 
 * @param value - The value to serialize
 * @returns A serializable version of the value with BigInts wrapped
 */
export function serializeBigInt(value: unknown): unknown {
    if (typeof value === "bigint") {
        return { $type: "BigInt", value: value.toString() } satisfies BigIntWrapper;
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeBigInt(item));
    }

    if (typeof value === "object" && value !== null) {
        const result: Record<string, unknown> = {};
        for (const [key, itemValue] of Object.entries(value)) {
            result[key] = serializeBigInt(itemValue);
        }
        return result;
    }

    return value;
}

/**
 * Recursively deserialize an object, converting BigInt wrapper objects back to BigInt values.
 * 
 * @param value - The value to deserialize
 * @returns A deserialized version of the value with BigInts restored
 */
export function deserializeBigInt(value: unknown): unknown {
    if (isBigIntWrapper(value)) {
        try {
            return BigInt(value.value);
        } catch {
            // If BigInt conversion fails, return the wrapper as-is
            console.warn(`Failed to deserialize BigInt from value: ${value.value}`);
            return value;
        }
    }

    if (Array.isArray(value)) {
        return value.map((item) => deserializeBigInt(item));
    }

    if (typeof value === "object" && value !== null) {
        const result: Record<string, unknown> = {};
        for (const [key, itemValue] of Object.entries(value)) {
            result[key] = deserializeBigInt(itemValue);
        }
        return result;
    }

    return value;
}

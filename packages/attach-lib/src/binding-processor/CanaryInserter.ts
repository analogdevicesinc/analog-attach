import { DtBindingSchema } from "../DtBindingSchema";
import { deep_merge, find_entry_in_object, overwrite_object_with_path_value } from "./ObjectUtilities.js";
import { PathValue } from "./UtilityTypes.js";

export function insert_canaries(binding: DtBindingSchema): DtBindingSchema {
    const branches = find_entry_in_object(
        binding,
        (path, key, _value) => {
            if (!['then', 'else'].includes(key)) {
                return false;
            }

            if (path.at(-1) === undefined || path.at(-2) !== 'allOf') {
                return false;
            }

            return true;
        }
    );

    const canaries: PathValue[] = branches.map(
        (path_entry) => {
            return {
                path: [...path_entry.path, path_entry.key],
                value: deep_merge(path_entry.value, { properties: { __canary__: false } })
            };
        }
    );

    const canary_binding = overwrite_object_with_path_value(binding, canaries);

    return canary_binding;
}
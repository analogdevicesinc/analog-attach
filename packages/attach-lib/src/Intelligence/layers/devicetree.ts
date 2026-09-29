import { query_devicetree } from "../query.js";
import { parent_path_string, suggest_parents } from "../parents.js";
import { IntelligenceLayer } from "./types.js";

// Layer 2: knowledge derived from the base device tree (controllers, buses, phandles).
export const devicetree_layer: IntelligenceLayer = {
    name: "devicetree",
    refine_properties(properties, context) {
        return query_devicetree(context.devicetree, properties, context.data, context.parent_name);
    },
    suggest_placement(binding, devicetree, lower) {
        return [
            ...lower,
            ...suggest_parents(devicetree, binding).map(parent => ({
                parent,
                display: parent_path_string(parent),
                source: "devicetree",
            })),
        ];
    },
};

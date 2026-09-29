import { insert_known_structures } from "../known_properties.js";
import { IntelligenceLayer } from "./types.js";

// Layer 1: knowledge derived from the binding alone (well-known property shapes).
export const binding_layer: IntelligenceLayer = {
    name: "binding",
    refine_properties(properties) {
        return insert_known_structures(properties);
    },
};

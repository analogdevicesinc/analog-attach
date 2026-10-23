import { Result } from "../result.js";
import { insert_canaries } from "./CanaryInserter.js";
import { SchemaContext } from "./Context.js";
import { apply_JSONSchema_fixups } from "./JSONSchemaFixups.js";
import { resolve_properties } from "./PropertyResolver.js";
import { merge_redefinitions } from "./RedefinitionMerger.js";
import { resolve_references } from "./RefResolver.js";
import { DtBindingSchema } from "./Schema.js";

export type PipelineStage = "references" | "properties" | "redefinitions" | "canaries" | "fixups";

export type PipelineError = {
    stage: PipelineStage;
    message: string;
};

/**
 * Runs a binding through every schema stage, up to the schema that gets
 * validated and translated: references → properties → redefinitions →
 * canaries → fixups.
 */
export async function process_binding(
    binding_path: string,
    ctx: SchemaContext,
): Promise<Result<DtBindingSchema, PipelineError>> {

    const reference_resolved = await resolve_references(binding_path, ctx);

    if (Result.is_err(reference_resolved)) {
        return Result.Err({ stage: "references", message: reference_resolved.error });
    }

    const property_resolved = await resolve_properties(reference_resolved.value, ctx);

    if (Result.is_err(property_resolved)) {
        return Result.Err({ stage: "properties", message: property_resolved.error });
    }

    const redefinition_merged = await merge_redefinitions(property_resolved.value, reference_resolved.value.refs, ctx);

    const canary_binding = insert_canaries(redefinition_merged);

    return Result.Ok(apply_JSONSchema_fixups(canary_binding, ctx.property_types));
}

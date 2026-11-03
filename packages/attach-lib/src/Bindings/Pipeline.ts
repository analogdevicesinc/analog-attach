import { Result } from "../result.js";
import { insert_canaries } from "./CanaryInserter.js";
import { SchemaContext } from "./Context.js";
import { apply_JSONSchema_fixups, StepInfo } from "./JSONSchemaFixups.js";
import { resolve_properties } from "./PropertyResolver.js";
import { merge_redefinitions } from "./RedefinitionMerger.js";
import { resolve_references } from "./RefResolver.js";
import { DtBindingSchema } from "./Schema.js";

/** The stages `process_binding` runs, in order. */
export const PIPELINE_STAGES = [
    {
        id: "references",
        summary: "Replaces every `$ref` with what it names, and tags each `types.yaml` definition with its name (`dtType`). dt-schema keeps the `$ref`s.",
    },
    {
        id: "properties",
        summary: "Fills each `property: true` placeholder with its definition from the files the binding references.",
    },
    {
        id: "redefinitions",
        summary: "Merges the `allOf` re-definitions of a property into its root definition.",
    },
    {
        id: "canaries",
        summary: "Puts the `__canary__` property in each `allOf` `then` / `else`, so that validation tells which branches apply.",
    },
    {
        id: "fixups", counterpart: "fixups.py",
        summary: "Patches the schema the way dt-schema's fixups do, and guesses the types dt-schema reads from the `$ref`s (`fixup_passes`).",
    },
] as const satisfies readonly StepInfo[];

export type PipelineStage = typeof PIPELINE_STAGES[number]["id"];

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

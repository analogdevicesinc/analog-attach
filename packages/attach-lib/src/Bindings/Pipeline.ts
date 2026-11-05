import { Result } from "../result.js";
import { insert_canaries } from "./CanaryInserter.js";
import { SchemaContext } from "./Context.js";
import { apply_JSONSchema_fixups, StepInfo } from "./JSONSchemaFixups.js";
import { resolve_properties } from "./PropertyResolver.js";
import { merge_redefinitions } from "./RedefinitionMerger.js";
import { resolve_references } from "./RefResolver.js";
import { merge_selected, selected_definitions } from "./SelectedSchemas.js";
import { DtBindingSchema } from "./Schema.js";
import type { PipelineTracer } from "./Trace.js";

/** The stages `process_binding` runs, in order. */
export const PIPELINE_STAGES = [
    {
        id: "references",
        summary: "Replaces every `$ref` with what it names, and tags each `types.yaml` definition with its name (`dtType`); dt-schema keeps the `$ref`s. Each file's own counts are fixed as it is read (`fixups.py:_fixup_items_size`), before its `$ref`s bring others.",
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
    {
        id: "selected", counterpart: "validator.py:DTValidator",
        summary: "Merges into each property a node names its definitions in the schemas dt-validate checks every node against (`select: true`: iio.yaml's 9 `mount-matrix` items, reg.yaml's 1 to 5 `reg` cells), each fixed up on its own; the tighter bounds hold.",
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
 * canaries → fixups → selected. `trace` gets the schema after each (`TraceEvent`).
 */
export async function process_binding(
    binding_path: string,
    ctx: SchemaContext,
    trace?: PipelineTracer,
): Promise<Result<DtBindingSchema, PipelineError>> {

    const reference_resolved = await resolve_references(binding_path, ctx);

    if (Result.is_err(reference_resolved)) {
        return Result.Err({ stage: "references", message: reference_resolved.error });
    }

    trace?.({
        kind: "stage", stage: "references", schema: structuredClone(reference_resolved.value.root_binding),
        refs: reference_resolved.value.refs.map(reference => reference.$id),
    });

    const property_resolved = await resolve_properties(reference_resolved.value, ctx);

    if (Result.is_err(property_resolved)) {
        return Result.Err({ stage: "properties", message: property_resolved.error });
    }

    trace?.({ kind: "stage", stage: "properties", schema: structuredClone(property_resolved.value) });

    const redefinition_merged = await merge_redefinitions(property_resolved.value, reference_resolved.value.refs, ctx);

    trace?.({ kind: "stage", stage: "redefinitions", schema: structuredClone(redefinition_merged) });

    const canary_binding = insert_canaries(redefinition_merged);

    trace?.({ kind: "stage", stage: "canaries", schema: structuredClone(canary_binding) });

    const fixuped = apply_JSONSchema_fixups(canary_binding, ctx.property_types, trace);

    trace?.({ kind: "stage", stage: "fixups", schema: structuredClone(fixuped) });

    const selected = merge_selected(fixuped, await selected_definitions(ctx));

    trace?.({ kind: "stage", stage: "selected", schema: structuredClone(selected) });

    return Result.Ok(selected);
}

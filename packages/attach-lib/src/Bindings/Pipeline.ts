import { Result } from "../result.js";
import { bindings_directory, create_context, SchemaContext, SchemaPaths } from "./Context.js";
import { apply_JSONSchema_fixups, StepInfo } from "./fixups/Fixups.js";
import type { ParsedBinding } from "./model/ParsedBinding.js";
import { DtBindingSchema } from "./schema/Schema.js";
import { insert_canaries } from "./stages/Canaries.js";
import { resolve_properties } from "./stages/Properties.js";
import { merge_redefinitions } from "./stages/Redefinitions.js";
import { resolve_references } from "./stages/References.js";
import { merge_selected, selected_definitions } from "./stages/Selected.js";
import { translate_JSONSchema } from "./stages/Translate.js";
import { filter_peripheral_properties, load_spi_peripherals, type ControllerContext } from "./stages/VendorFilter.js";
import type { PipelineTracer } from "./Trace.js";

/** The schema stages `process_schema` runs, in order. */
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
        summary: "Merges into each property a node names its definitions in the schemas dt-validate checks every node against (`select: true`: iio.yaml's 9 `mount-matrix` items, reg.yaml's 1 to 5 `reg` cells), and into each property pattern those of the same key (pinctrl-consumer.yaml's `^pinctrl-[0-9]+$`), each fixed up on its own; the tighter bounds hold.",
    },
] as const satisfies readonly StepInfo[];

export type PipelineStage = typeof PIPELINE_STAGES[number]["id"];

/** What `parse_binding` runs, in order: the schema stages, then the translation to a `ParsedBinding`. */
export const PARSE_STEPS = [
    ...PIPELINE_STAGES,
    {
        id: "translate",
        summary: "Builds the `ParsedBinding`: each property's `AttachType`, the child-node patterns and the property patterns.",
    },
    {
        id: "vendor-filter",
        summary: "Drops the vendor-specific SPI peripheral properties (`pl022,`, `nvidia,`) of a controller that isn't the node's, and under a controller that isn't an SPI one (named in `ControllerContext`) the SPI peripheral properties the binding doesn't require, when the controller is given.",
    },
] as const satisfies readonly StepInfo[];

export type PipelineError = {
    stage: PipelineStage;
    message: string;
};

export type ParseOptions = {
    /** The node's parent, for the vendor filter; without it no property is dropped. */
    controller?: ControllerContext;
    /** Gets the binding after each step of `PARSE_STEPS`, and what each fixup changed (`TraceEvent`). */
    trace?: PipelineTracer;
};

/** A binding through every step of `PARSE_STEPS`. */
export type ProcessedBinding = {
    /** The schema after the schema stages, which the branch narrowing compiles. */
    schema: DtBindingSchema;
    /** `schema` translated and filtered. */
    binding: ParsedBinding;
    /** The translation and filter `binding` went through, for a narrowing of `schema`. */
    to_binding: (schema: DtBindingSchema) => ParsedBinding;
};

/**
 * The entry point of `Bindings`: the binding at `binding_path` (a YAML file) run through every step of
 * `PARSE_STEPS`, resolved against `paths`. `options.trace` gets the binding after each step.
 */
export async function parse_binding(
    binding_path: string,
    paths: SchemaPaths,
    options?: ParseOptions,
): Promise<Result<ProcessedBinding, PipelineError>> {

    const trace = options?.trace;
    const processed = await process_schema(binding_path, create_context(paths), trace);

    if (Result.is_err(processed)) {
        return processed;
    }

    const translated = translate_JSONSchema(processed.value);
    trace?.({ kind: "translated", step: "translate", binding: structuredClone(translated) });

    const controller = options?.controller;
    const spi = controller === undefined ? undefined : load_spi_peripherals(bindings_directory(paths));
    const filter = (binding: ParsedBinding): ParsedBinding => filter_peripheral_properties(binding, controller, spi);
    const binding = filter(translated);
    trace?.({ kind: "translated", step: "vendor-filter", binding: structuredClone(binding) });

    return Result.Ok({ schema: processed.value, binding, to_binding: schema => filter(translate_JSONSchema(schema)) });
}

/**
 * Runs a binding through every schema stage, up to the schema that gets
 * narrowed and translated: references → properties → redefinitions →
 * canaries → fixups → selected. `trace` gets the schema after each (`TraceEvent`).
 */
export async function process_schema(
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

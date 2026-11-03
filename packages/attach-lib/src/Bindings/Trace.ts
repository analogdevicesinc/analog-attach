import type { ParsedBinding } from "./ParsedBinding.js";
import type { PipelineStage } from "./Pipeline.js";
import type { DtBindingSchema } from "./Schema.js";

/**
 * What a binding looked like at a step of `Attach.parse`, for showing how it got to its `ParsedBinding`
 * (`ParseOptions.trace`). Every schema is a copy the tracer can keep: the pipeline goes on changing its own.
 * A copy keeps the objects the dereferencing shares (one `types.yaml` definition under many properties) shared.
 *
 * - `stage`: the whole schema after a stage of `PIPELINE_STAGES`; after `references`, the `$id`s it pulled in too.
 * - `pass`: the whole schema after a pass of `fixup_passes`, within the `fixups` stage.
 * - `fixup`: one fixup of a walk pass changed one schema, a property's (or one of its `oneOf` branches') or a node's.
 *   `pointer` is where the schema is in the binding, as the keys down to it (`["properties", "reg"]`,
 *   `["allOf", "0", "then", "properties", "reg"]`); `name` is the property's, for a property fixup. A fixup that
 *   changes nothing isn't reported, and neither is what it changes through an object another schema shares.
 * - `translated`: the `ParsedBinding` after `translate`, and after `vendor-filter`.
 */
export type TraceEvent =
    | { kind: "stage"; stage: PipelineStage; schema: DtBindingSchema; refs?: string[] }
    | { kind: "pass"; pass: string; schema: DtBindingSchema }
    | { kind: "fixup"; pass: string; fixup: string; target: "property" | "node"; pointer: string[]; name?: string; before: unknown; after: unknown }
    | { kind: "translated"; step: "translate" | "vendor-filter"; binding: ParsedBinding };

export type PipelineTracer = (event: TraceEvent) => void;

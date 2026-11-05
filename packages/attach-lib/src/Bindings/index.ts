// What `Bindings` offers the rest of the lib: `parse_binding` turns a binding's YAML into a `ParsedBinding`
// (`Pipeline.ts`), the model types describe it, and the schema vocabulary is what the branch narrowing
// (`Attach/Narrowing.ts`) reads the processed schema with. Import from here, not from the files under it.

// The entry point and its steps
export {
    parse_binding,
    PARSE_STEPS,
    PIPELINE_STAGES,
    type ParseOptions,
    type PipelineError,
    type PipelineStage,
    type ProcessedBinding,
} from "./Pipeline.js";
export type { SchemaPaths } from "./Context.js";
export type { TraceEvent, PipelineTracer } from "./Trace.js";
export { fixup_passes, type StepInfo, type FixupPass } from "./fixups/Fixups.js";
export type { ControllerContext } from "./stages/VendorFilter.js";

// What it produces
export type { ResolvedProperty, PatternPropertyRule, PropertyPatternRule, ParsedBinding } from "./model/ParsedBinding.js";
export {
    AttachEnumType,
    is_list,
    is_open,
    is_open_list,
    list_cell,
    matrix_cell,
    type AttachType,
    type Cell,
    type EnumOption,
    type List,
} from "./model/AttachType.js";
export { expand_pattern, type PatternExpansion } from "./PatternExpansion.js";

// The processed schema, for the branch narrowing
export { deep_merge, is_schema, value_at, type DtBindingSchema, type Schema } from "./schema/Schema.js";
export { CANARY } from "./stages/Canaries.js";
export { DT_TYPE } from "./stages/References.js";

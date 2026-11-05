import { ParsedBinding } from '../Bindings/ParsedBinding.js';

import { bindings_directory, create_context, SchemaPaths } from '../Bindings/Context.js';
import { translate_JSONSchema } from '../Bindings/JSONSchemaTranslate.js';
import { PIPELINE_STAGES, PipelineStage, process_binding } from '../Bindings/Pipeline.js';
import type { StepInfo } from '../Bindings/JSONSchemaFixups.js';
import type { PipelineTracer } from '../Bindings/Trace.js';
import { Result } from '../result.js';
import { filter_peripheral_properties, load_spi_peripherals, type ControllerContext } from '../Bindings/VendorPeripheralFilter.js';
import { compile_targets, narrow, ValidationTarget } from './Validation.js';

export type ParseOptions = {
    controller?: ControllerContext;
    /** Gets the binding after each step of `PARSE_STEPS`, and what each fixup changed (`TraceEvent`). */
    trace?: PipelineTracer;
};

export type BindingParseError = {
    stage: PipelineStage | "validation";
    message: string;
};

/** What `Attach.parse` runs, in order: the pipeline's stages, then the translation to a `ParsedBinding`. */
export const PARSE_STEPS: readonly StepInfo[] = [
    ...PIPELINE_STAGES,
    {
        id: "translate",
        summary: "Builds the `ParsedBinding`: each property's `AttachType`, the child-node patterns and the property patterns.",
    },
    {
        id: "vendor-filter",
        summary: "Drops the vendor-specific SPI peripheral properties (`pl022,`, `nvidia,`) of a controller that isn't the node's, and under a controller that isn't an SPI one (named in `ControllerContext`) the SPI peripheral properties the binding doesn't require, when the controller is given.",
    },
];

/** A binding processed down to a `ParsedBinding`, with the validators that narrow it as the node's data changes. */
export class Attach {

    /** The names of the child-node patterns the binding allows. */
    public get patterns(): string[] {
        return this.parsed_binding.pattern_properties?.map(pattern => pattern.pattern) ?? [];
    }

    private constructor(
        private readonly root: ValidationTarget,
        private readonly pattern_targets: Map<string, ValidationTarget>,
        public readonly parsed_binding: ParsedBinding,
        /** The peripheral filter of `parse`, which a narrowed binding goes through too: narrowing translates it again. */
        private readonly filter: (binding: ParsedBinding) => ParsedBinding,
    ) { }

    public static async parse(
        binding_path: string,
        paths: SchemaPaths,
        options?: ParseOptions,
    ): Promise<Result<Attach, BindingParseError>> {

        const trace = options?.trace;
        const processed = await process_binding(binding_path, create_context(paths), trace);

        if (Result.is_err(processed)) {
            return processed;
        }

        const translated = translate_JSONSchema(processed.value);
        trace?.({ kind: "translated", step: "translate", binding: structuredClone(translated) });
        const controller = options?.controller;
        const spi = controller === undefined ? undefined : load_spi_peripherals(bindings_directory(paths));
        const filter = (binding: ParsedBinding): ParsedBinding => filter_peripheral_properties(binding, controller, spi);
        const parsed_binding = filter(translated);
        trace?.({ kind: "translated", step: "vendor-filter", binding: structuredClone(parsed_binding) });

        try {
            const targets = compile_targets(processed.value);
            return Result.Ok(new Attach(targets.root, targets.patterns, parsed_binding, filter));
        } catch (error) {
            return Result.Err({ stage: "validation", message: error instanceof Error ? error.message : "Failed to compile validation function" });
        }
    }

    public update_binding_by_changes(data: string): ParsedBinding | undefined {
        return this.filtered(narrow(this.root, data));
    }

    public update_pattern_binding_by_changes(pattern: string, data: string): ParsedBinding | undefined {
        const target = this.pattern_targets.get(pattern);

        if (target === undefined) {
            return;
        }

        return this.filtered(narrow(target, data));
    }

    private filtered(binding: ParsedBinding | undefined): ParsedBinding | undefined {
        return binding === undefined ? undefined : this.filter(binding);
    }
}

import { BindingErrors } from './Errors.js';
import { ParsedBinding } from '../Bindings/ParsedBinding.js';

import { create_context, SchemaPaths } from '../Bindings/Context.js';
import { translate_JSONSchema } from '../Bindings/JSONSchemaTranslate.js';
import { PipelineStage, process_binding } from '../Bindings/Pipeline.js';
import { Result } from '../result.js';
import { filter_vendor_peripheral_properties, type ControllerContext } from '../Bindings/VendorPeripheralFilter.js';
import { compile_targets, narrow, ValidationTarget } from './Validation.js';

export type ParseOptions = {
    controller?: ControllerContext;
};

export type BindingParseError = {
    stage: PipelineStage | "validation";
    message: string;
};

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
    ) { }

    public static async parse(
        binding_path: string,
        paths: SchemaPaths,
        options?: ParseOptions,
    ): Promise<Result<Attach, BindingParseError>> {

        const processed = await process_binding(binding_path, create_context(paths));

        if (Result.is_err(processed)) {
            return processed;
        }

        const parsed_binding = filter_vendor_peripheral_properties(translate_JSONSchema(processed.value), options?.controller);

        try {
            const targets = compile_targets(processed.value);
            return Result.Ok(new Attach(targets.root, targets.patterns, parsed_binding));
        } catch (error) {
            return Result.Err({ stage: "validation", message: error instanceof Error ? error.message : "Failed to compile validation function" });
        }
    }

    public update_binding_by_changes(data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {
        return narrow(this.root, data);
    }

    public update_pattern_binding_by_changes(pattern: string, data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {
        const target = this.pattern_targets.get(pattern);

        if (target === undefined) {
            return;
        }

        return narrow(target, data);
    }
}

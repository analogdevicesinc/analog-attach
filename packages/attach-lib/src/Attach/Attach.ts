import { parse_binding, type DtBindingSchema, type ParsedBinding, type ParseOptions, type PipelineStage, type SchemaPaths } from '../Bindings/index.js';
import { Result } from '../result.js';
import { compile_targets, narrow, NarrowingTarget } from './Narrowing.js';

export type BindingParseError = {
    stage: PipelineStage | "narrowing";
    message: string;
};

/** A binding processed down to a `ParsedBinding`, with the validators that narrow it as the node's data changes. */
export class Attach {

    /** The names of the child-node patterns the binding allows. */
    public get patterns(): string[] {
        return this.parsed_binding.pattern_properties?.map(pattern => pattern.pattern) ?? [];
    }

    private constructor(
        private readonly root: NarrowingTarget,
        private readonly pattern_targets: Map<string, NarrowingTarget>,
        public readonly parsed_binding: ParsedBinding,
        /** What a narrowed schema goes through to become a binding, as the parsed one did (`ProcessedBinding`). */
        private readonly to_binding: (schema: DtBindingSchema) => ParsedBinding,
    ) { }

    public static async parse(
        binding_path: string,
        paths: SchemaPaths,
        options?: ParseOptions,
    ): Promise<Result<Attach, BindingParseError>> {

        const parsed = await parse_binding(binding_path, paths, options);

        if (Result.is_err(parsed)) {
            return parsed;
        }

        try {
            const targets = compile_targets(parsed.value.schema);
            return Result.Ok(new Attach(targets.root, targets.patterns, parsed.value.binding, parsed.value.to_binding));
        } catch (error) {
            return Result.Err({ stage: "narrowing", message: error instanceof Error ? error.message : "AJV failed to compile the binding" });
        }
    }

    public narrow_binding(data: string): ParsedBinding | undefined {
        return this.translated(narrow(this.root, data));
    }

    public narrow_pattern_binding(pattern: string, data: string): ParsedBinding | undefined {
        const target = this.pattern_targets.get(pattern);

        if (target === undefined) {
            return;
        }

        return this.translated(narrow(target, data));
    }

    private translated(schema: DtBindingSchema | undefined): ParsedBinding | undefined {
        return schema === undefined ? undefined : this.to_binding(schema);
    }
}

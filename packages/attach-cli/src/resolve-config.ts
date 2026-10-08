import type { LocalContext } from "./context";
import { load_config, check_config, check_failure_message, type AttachConfig, type Checked, type ParsedConfig } from "./config";
import { input_error } from "./protocol/output";

/**
 * Load the config and verify the required fields, emitting the standard
 * diagnostics (missing env var / missing field / missing path) and returning
 * undefined on any failure. On success returns the narrowed required values,
 * the full config, and the parsed representations of `context` and `board`
 * (when those fields were among the required set).
 */
export function resolve_config<K extends keyof AttachConfig>(
    context: LocalContext,
    required: readonly K[],
): { values: Checked<K>; config: AttachConfig; parsed: ParsedConfig } | undefined {
    const config = load_config() ?? {};

    const checked = check_config(config, required);
    if (!checked.ok) {
        const message = check_failure_message(checked);
        if (context.json) { input_error(message.json); }
        else { console.log(message.human); }
        return undefined;
    }

    return { values: checked.values, config, parsed: checked.parsed };
}

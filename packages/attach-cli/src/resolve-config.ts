import type { LocalContext } from "./context";
import { load_config, check_config, check_failure_message, type AttachConfig, type Checked } from "./config";
import { input_error } from "./protocol/output";

/**
 * Load the config and verify the required fields, emitting the standard
 * diagnostics (no config file / missing field / missing path) and returning
 * undefined on any failure. On success returns the narrowed required values
 * plus the full config (for reading optional fields without a second load).
 * NOTE: path to context/overlay validation involves parsing so checks outside are extra, but better still kept until we can return DT/DTO from here
 */
export function resolve_config<K extends keyof AttachConfig>(
    context: LocalContext,
    required: readonly K[],
): { values: Checked<K>; config: AttachConfig } | undefined {
    const config = load_config();
    if (config === undefined) {
        if (context.json) { input_error("no config.toml (run config-set)"); }
        else { console.log("No config.toml (run config-set)"); }
        return undefined;
    }

    const checked = check_config(config, required);
    if (!checked.ok) {
        const message = check_failure_message(checked);
        if (context.json) { input_error(message.json); }
        else { console.log(message.human); }
        return undefined;
    }

    return { values: checked.values, config };
}

import { Result, ok, error } from "../ruleset_parser/result";
import { Context, PlatformManifest } from "./types";

export class ContextHandler {
	private context: Context;

	constructor() {
		this.context = this.create_context();
	}

	// --- Context Management ---

	create_context(): Context {
		return {
			selected_platform: undefined,
			platform_specs: {},
		};
	}

	get_context(): Readonly<Context> {
		return this.context;
	}

	// --- Platform Operations ---

	set_platform(platform_id: string): Result<void> {
		if (!(platform_id in this.context.platform_specs)) {
			return error(`Unknown platform '${platform_id}'`, "platform_id");
		}
		this.context.selected_platform = platform_id;
		return ok();
	}

	get_selected_platform(): string | undefined {
		return this.context.selected_platform;
	}

	get_platform_manifest(): PlatformManifest | undefined {
		const platform = this.context.selected_platform;
		if (!platform) {
			return undefined;
		}
		return this.context.platform_specs[platform];
	}

	// --- Platform Specs Management ---

	set_platform_specifications(platform_id: string, manifest: PlatformManifest): void {
		this.context.platform_specs[platform_id] = manifest;
	}

	get_platform_specifications(platform_id: string): PlatformManifest | undefined {
		return this.context.platform_specs[platform_id];
	}

	get_available_platforms(): string[] {
		return Object.keys(this.context.platform_specs);
	}

	// --- Persistence ---

	load_context(context: Context): void {
		this.context = context;
	}

	export_context(): Context {
		return structuredClone(this.context);
	}
}

import { Result, ok, error } from "../bindings_parser/result";
import { Capability, CapabilitySpec, Context, PlatformCapabilities, Symbol } from "./types";

export class ContextHandler {
	private context: Context;

	constructor() {
		this.context = this.create_context();
	}

	// --- Context Management ---

	create_context(): Context {
		return {
			selected_platform: undefined,
			symbols: [],
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

	has_capability(capability: Capability): boolean {
		const platform = this.context.selected_platform;
		if (!platform) {
			return false;
		}
		const capabilities = this.context.platform_specs[platform];
		if (!capabilities) {
			return false;
		}
		return capability in capabilities;
	}

	get_capability_specification(capability: Capability): CapabilitySpec | undefined {
		const platform = this.context.selected_platform;
		if (!platform) {
			return undefined;
		}
		const capabilities = this.context.platform_specs[platform];
		if (!capabilities) {
			return undefined;
		}
		return capabilities[capability];
	}

	get_capabilities(): Capability[] {
		const platform = this.context.selected_platform;
		if (!platform) {
			return [];
		}
		const capabilities = this.context.platform_specs[platform];
		if (!capabilities) {
			return [];
		}
		return Object.keys(capabilities) as Capability[];
	}

	// --- Platform Specs Management ---

	set_platform_specifications(platform_id: string, capabilities: PlatformCapabilities): void {
		this.context.platform_specs[platform_id] = capabilities;
	}

	get_platform_specifications(platform_id: string): PlatformCapabilities | undefined {
		return this.context.platform_specs[platform_id];
	}

	get_available_platforms(): string[] {
		return Object.keys(this.context.platform_specs);
	}

	// --- Symbol CRUD ---

	add_symbol(type: string, symbol: string, capabilities?: Capability[]): Result<Symbol> {
		if (this.has_symbol(symbol)) {
			return error(`Symbol '${symbol}' already exists`, "symbol");
		}
		const new_symbol: Symbol = { type, symbol, capabilities };
		this.context.symbols.push(new_symbol);
		return ok(new_symbol);
	}

	remove_symbol(symbol: string): Result<void> {
		const index = this.context.symbols.findIndex(s => s.symbol === symbol);
		if (index === -1) {
			return error(`Symbol '${symbol}' not found`, "symbol");
		}
		this.context.symbols.splice(index, 1);
		return ok();
	}

	get_symbols(): Symbol[] {
		return this.context.symbols;
	}

	get_symbols_by_type(type: string): Symbol[] {
		return this.context.symbols.filter(s => s.type === type);
	}

	has_symbol(symbol: string): boolean {
		return this.context.symbols.some(s => s.symbol === symbol);
	}

	rename_symbol(old_name: string, new_name: string): Result<void> {
		if (this.has_symbol(new_name)) {
			return error(`Symbol '${new_name}' already exists`, "new_name");
		}
		const symbol = this.context.symbols.find(s => s.symbol === old_name);
		if (!symbol) {
			return error(`Symbol '${old_name}' not found`, "old_name");
		}
		symbol.symbol = new_name;
		return ok();
	}

	// --- Persistence ---

	load_context(context: Context): void {
		this.context = context;
	}

	export_context(): Context {
		return structuredClone(this.context);
	}
}

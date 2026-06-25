export type Settings = {
	schemas_path: string | null;
};

let settings: Settings = {
	schemas_path: null,
};

export function get_schemas_path(): string | null {
	return settings.schemas_path;
}

export function set_schemas_path(path: string): void {
	settings.schemas_path = path;
}

export function clear_schemas_path(): void {
	settings.schemas_path = null;
}

export function get_settings(): Readonly<Settings> {
	return { ...settings };
}

export function reset_settings(): void {
	settings = {
		schemas_path: null,
	};
}

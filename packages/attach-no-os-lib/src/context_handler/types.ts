/**
 * Platform manifest - lists ops and structs available for this platform
 */
export type PlatformManifest = {
	name: string;       // platform name e.g. "max32690"
	ops: string[];      // paths to ops yaml files
	structs: string[];  // paths to struct yaml files (extras)
};

/**
 * Platform specs indexed by platform ID
 */
export type PlatformSpecs = {
	[platform_id: string]: PlatformManifest;
};

export type Context = {
	selected_platform?: string;
	platform_specs: PlatformSpecs;
};

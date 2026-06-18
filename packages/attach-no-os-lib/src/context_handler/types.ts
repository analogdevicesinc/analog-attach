/**
 * Platform capability identifier
 * Examples: "spi", "i2c", "gpio", "uart", "dma", "irq", "pwm", "timer"
 * Platform-specific variants: "spi_engine", "spi_pl", "gpio_irq" (e.g., Xilinx)
 */
export type Capability = string;

/**
 * A symbol instance created by the user (e.g., a struct variable)
 */
export type Symbol = {
	type: string;              // e.g., "no_os_spi_init_param"
	symbol: string;            // e.g., "no_os_spi_ip"
	capabilities?: Capability[]; // capabilities required by this symbol's binding (from $requires)
};

/**
 * Platform capability specification - paths to ops and extra bindings
 */
export type CapabilitySpec = {
	ops?: string;    // path to ops yaml, e.g., "platform_ops/spi_ops.yaml"
	extra?: string;  // path to extra yaml, e.g., "max_spi_init_param.yaml"
};

/**
 * All capabilities supported by a platform
 */
export type PlatformCapabilities = {
	[K in Capability]?: CapabilitySpec;
};

/**
 * Platform specs indexed by platform ID
 */
export type PlatformSpecs = {
	[platform_id: string]: PlatformCapabilities;
};

/**
 * The runtime context state
 */
export type Context = {
	selected_platform?: string;
	symbols: Symbol[];
	platform_specs: PlatformSpecs;
};

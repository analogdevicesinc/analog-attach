import type { PatchSchedule, RuntimeAssignment } from "./types";

// WHERE a runtime patch goes in main().
//
// A patch copies something that only exists at runtime into a file-scope struct:
//
//     child_spi_ip.parent = desc.parent_spi;
//
// `desc.parent_spi` is NULL until `no_os_spi_init(&desc.parent_spi, ...)` has run, so
// emitting every patch in one block before every init — which is what codegen used to do —
// copies NULL. The value has to be read after its source exists, and written before the
// struct it lands in is consumed.
//
// Upstream writes exactly that by hand (iio_trigger_example.c:106-118): init the interrupt
// controller, patch the trigger init_param with it, then init the trigger.
//
// Both bounds are satisfied by placing each patch as EARLY as its source allows:
//
//   lower bound — a patch is placed only once its source is complete. A descriptor is
//     complete after its own init; a plain struct is complete once every patch INTO it has
//     been placed (a struct copied by value must be whole before it is copied).
//   upper bound — falls out of the topological symbol order. A patch is placed no later
//     than the init that completes its source, and the descriptor that consumes the
//     patched struct depends on that struct, which depends on the source, so its init is
//     strictly later.
//
// The result is a `before` block (patches whose sources need no init at all) plus one
// bucket per descriptor, emitted right after that descriptor's init.
//
// KNOWN LIMIT, pre-existing and orthogonal: `prioritize_devices` floats irq and uart
// capabilities to the front of the init order, which can put a consumer before its source
// if a uart init_param ever references another descriptor. That reorders the inits
// themselves, so it is broken with or without this scheduling; the throw below is what
// surfaces it instead of emitting a NULL copy.
export function schedule_patches(
	assignments: RuntimeAssignment[],
	init_order: string[],
): PatchSchedule {
	const descriptors = new Set(init_order);

	// How many patches still have to be placed into each struct. A struct source is
	// complete when its count reaches zero — including structs that were never a target,
	// which are complete from the start.
	const outstanding = new Map<string, number>();
	for (const assignment of assignments) {
		outstanding.set(assignment.struct_name, (outstanding.get(assignment.struct_name) ?? 0) + 1);
	}

	let pending = [...assignments];
	const initialized = new Set<string>();

	const is_ready = (assignment: RuntimeAssignment): boolean =>
		descriptors.has(assignment.source)
			? initialized.has(assignment.source)
			: (outstanding.get(assignment.source) ?? 0) === 0;

	// Place everything whose source is complete, then look again: placing a patch can
	// complete the struct it wrote into, which can in turn release a patch that copies
	// that struct. Declaration order is preserved within a bucket.
	const drain = (): RuntimeAssignment[] => {
		const placed: RuntimeAssignment[] = [];

		let progressed = true;
		while (progressed) {
			progressed = false;
			const held: RuntimeAssignment[] = [];

			for (const assignment of pending) {
				if (!is_ready(assignment)) {
					held.push(assignment);
					continue;
				}

				placed.push(assignment);
				outstanding.set(assignment.struct_name, (outstanding.get(assignment.struct_name) ?? 1) - 1);
				progressed = true;
			}

			pending = held;
		}

		return placed;
	};

	const before = drain();
	const after = new Map<string, RuntimeAssignment[]>();

	for (const descriptor of init_order) {
		initialized.add(descriptor);
		const placed = drain();
		if (placed.length > 0) {
			after.set(descriptor, placed);
		}
	}

	// Nothing may be dropped: a patch left over reads something that never becomes
	// complete, which means a genuine cycle or a source that is not in the init order.
	if (pending.length > 0) {
		const unplaced = pending.map(a => `${a.struct_name}.${a.field_path} = ${a.value}`).join(", ");
		throw new Error(
			`Cannot order the runtime patches: ${unplaced}. Each reads a symbol that is never ready, so the references form a cycle.`
		);
	}

	return { before, after };
}

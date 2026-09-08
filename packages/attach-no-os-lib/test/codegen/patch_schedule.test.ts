import { describe, test, expect } from 'vitest';
import { schedule_patches } from '../../src/codegen/patch_schedule';
import { RuntimeAssignment } from '../../src/codegen/types';

function patch(struct_name: string, field_path: string, source: string): RuntimeAssignment {
    return { struct_name, field_path, value: `desc.${source}`, source };
}

function lines(assignments: RuntimeAssignment[]): string[] {
    return assignments.map(a => `${a.struct_name}.${a.field_path} = ${a.value}`);
}

describe('schedule_patches', () => {
    test('places a descriptor patch after that descriptor init', () => {
        const schedule = schedule_patches(
            [patch("child_spi_ip", "parent", "parent_spi")],
            ["parent_spi", "child_spi"]
        );

        expect(schedule.before).toEqual([]);
        expect(lines(schedule.after.get("parent_spi") ?? [])).toEqual([
            "child_spi_ip.parent = desc.parent_spi",
        ]);
        expect(schedule.after.has("child_spi")).toBe(false);
    });

    test('keeps declaration order inside one bucket', () => {
        const schedule = schedule_patches(
            [
                patch("trig_ip", "irq_ctrl", "irq_ctrl"),
                patch("app_ip", "irq_desc", "irq_ctrl"),
            ],
            ["irq_ctrl", "trig", "app"]
        );

        expect(lines(schedule.after.get("irq_ctrl") ?? [])).toEqual([
            "trig_ip.irq_ctrl = desc.irq_ctrl",
            "app_ip.irq_desc = desc.irq_ctrl",
        ]);
    });

    // A source nothing inits needs no init to be live, so its patch can go first. This is
    // the union case: `spi_ip.extra.max = &max_spi_ip` reads a file-scope struct.
    test('places a patch reading a plain struct before every init', () => {
        const schedule = schedule_patches(
            [{ struct_name: "spi_ip", field_path: "extra.max", value: "&max_spi_ip", source: "max_spi_ip" }],
            ["parent_spi"]
        );

        expect(lines(schedule.before)).toEqual(["spi_ip.extra.max = &max_spi_ip"]);
        expect(schedule.after.size).toBe(0);
    });

    // A struct copied by value must be whole before it is read, so a patch reading it
    // waits for every patch written INTO it.
    test('delays a patch whose source struct is still being patched', () => {
        const schedule = schedule_patches(
            [
                { struct_name: "outer_ip", field_path: "inner", value: "&inner_ip", source: "inner_ip" },
                patch("inner_ip", "parent", "parent_spi"),
            ],
            ["parent_spi", "outer"]
        );

        expect(schedule.before).toEqual([]);
        expect(lines(schedule.after.get("parent_spi") ?? [])).toEqual([
            "inner_ip.parent = desc.parent_spi",
            "outer_ip.inner = &inner_ip",
        ]);
    });

    test('is a no-op for no patches', () => {
        const schedule = schedule_patches([], ["a", "b"]);

        expect(schedule.before).toEqual([]);
        expect(schedule.after.size).toBe(0);
    });

    // Two structs each reading the other can never both be complete first. Nothing may be
    // silently dropped, so this throws rather than emitting a NULL copy.
    test('throws on a cycle between two structs', () => {
        expect(() => schedule_patches(
            [
                { struct_name: "a_ip", field_path: "peer", value: "&b_ip", source: "b_ip" },
                { struct_name: "b_ip", field_path: "peer", value: "&a_ip", source: "a_ip" },
            ],
            []
        )).toThrow(/cycle/);
    });

    // A name absent from the init order is read as a plain struct, not as a descriptor
    // waiting to be inited. Safe because load_devices yields an entry for every descriptor
    // node, so a descriptor source is always in the order.
    test('treats an unknown source as a plain struct', () => {
        const schedule = schedule_patches([patch("a_ip", "field", "elsewhere")], []);

        expect(lines(schedule.before)).toEqual(["a_ip.field = desc.elsewhere"]);
    });
});

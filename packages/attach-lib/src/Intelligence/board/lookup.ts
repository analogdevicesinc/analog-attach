import { BoardBus, BoardSignal, BoardSlot } from "./types.js";

export function bus_named(buses: BoardBus[], name: string): BoardBus | undefined {
    return buses.find(b => b.name === name);
}

export function spi_bus_of(buses: BoardBus[], slot: BoardSlot): BoardBus | undefined {
    return buses.find(bus => bus.type === "spi" && slot.buses.includes(bus.name));
}

export function signal_reference(slot: BoardSlot, signal: BoardSignal | { name: string }): string {
    return `${slot.id}.${signal.name}`;
}

export function label_name(reference: string): string {
    return reference.startsWith("&") ? reference.slice(1) : reference;
}

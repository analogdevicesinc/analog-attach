// The Linux part's value editors: a property's value edited in the shape its binding gives it
// (list property's type): a form, rather than one line of words.
//
//   a tuple (interrupts: number, number, IRQ macro)  one field per position, the macros offered
//   an array of a fixed length (diff-channels: 2)    that many fields
//   an array of any length, or a matrix               rows of fields, a row added or removed
//
// A position whose binding lists its values (an enum: macros, labels) offers them; the field
// still takes a number. The shape can follow another property (interrupts follows
// interrupt-parent's #interrupt-cells): the part reads the type again after each change, and a
// value that no longer fits is said so. Every change is one `analog-attach update` with the cells
// in order (the controller runs it; `cell_words` gives them).
//
// A number field shows the number's other representation greyed at its right edge (decimal typed:
// hex; hex typed: decimal), what is typed being what is written; a value read shows its numbers as
// the file writes them (written_value), so 0x53 stays 0x53 after a reload. A list of labels (a
// phandle's cell) ends with the nodes the user can add for it (＋ Add a fixed-clock…), and a field
// holding a label that exists has → to go to it: the controller says which (`links`) and does both.

import { esc } from "../../core/ui.mjs";

/** The values of the macros devicetree bindings use most, to name a number the read gives. */
const MACROS = {
	IRQ_TYPE_NONE: 0, IRQ_TYPE_EDGE_RISING: 1, IRQ_TYPE_EDGE_FALLING: 2, IRQ_TYPE_EDGE_BOTH: 3,
	IRQ_TYPE_LEVEL_HIGH: 4, IRQ_TYPE_LEVEL_LOW: 8, GPIO_ACTIVE_HIGH: 0, GPIO_ACTIVE_LOW: 1,
	GIC_SPI: 0, GIC_PPI: 1,
};

/**
 * The shape of a binding type: `{ positions, rows, grouped, loose }`, or undefined for a scalar the
 * one-line editor keeps. `positions` are the types of one row's cells; `rows` how many rows: a
 * number when the binding fixes it, `{ min, max }` when it doesn't (`max` undefined: as many as
 * wanted). `grouped`: each row is its own cell
 * array (a tuple: a phandle and its arguments; or an array of arrays), written `<…>, <…>`, rows
 * separated by `,` in update's value (GRM-070 to GRM-072, UPDATE-032); otherwise the cells are one
 * array. `loose`: an array of arrays whose rows' width the binding doesn't fix (reg: by the
 * parent's #address-cells and #size-cells), taken from the value where it has rows.
 */
export function shape_of(type) {
	// One tuple, not a list of them (a binding's maxItems: 1, rdy-gpios = <&gpio 25 1>): one row.
	if (type?.kind === "tuple" && (type.items ?? []).length > 0) return { positions: type.items, rows: 1, grouped: true, loose: false };
	if (type?.kind !== "array") return undefined;
	const items = type.items ?? {};
	const fixed = (count, width) => count !== undefined && count === type.max_items && count % width === 0 ? count / width : undefined;
	if (items.kind === "tuple") {
		const positions = items.items ?? [];
		if (positions.length === 0) return undefined;
		const rows = fixed(type.min_items, positions.length);
		const max = type.max_items === undefined ? undefined : Math.max(1, Math.floor(type.max_items / positions.length));
		return { positions, rows: rows ?? { min: Math.max(1, Math.ceil((type.min_items ?? positions.length) / positions.length)), max }, grouped: true, loose: false };
	}
	if (items.kind === "array") {
		// A matrix: rows of an inner array, its length fixed or not.
		const inner = items.items ?? {};
		const width = inner.kind === "tuple" ? inner.items?.length ?? 1 : items.min_items !== undefined && items.min_items === items.max_items ? items.min_items : 1;
		const positions = inner.kind === "tuple" ? inner.items : Array.from({ length: width }, () => inner);
		const loose = inner.kind !== "tuple" && !(items.min_items !== undefined && items.min_items === items.max_items);
		const rows = type.min_items !== undefined && type.min_items === type.max_items ? type.min_items : { min: Math.max(1, type.min_items ?? 1), max: type.max_items };
		return { positions, rows, grouped: true, loose, inner };
	}
	// An array of one kind: a fixed count is that many fields, else a row of one per cell.
	if (type.min_items !== undefined && type.min_items === type.max_items) {
		return { positions: Array.from({ length: type.min_items }, () => items), rows: 1, grouped: false, loose: false };
	}
	return { positions: [items], rows: { min: Math.max(1, type.min_items ?? 1), max: type.max_items }, grouped: false, loose: false };
}

/** The flags of a GPIO specifier, as dt-bindings/gpio/gpio.h names them. */
const GPIO_FLAGS = ["GPIO_ACTIVE_HIGH", "GPIO_ACTIVE_LOW", "GPIO_OPEN_DRAIN", "GPIO_OPEN_SOURCE", "GPIO_PULL_UP", "GPIO_PULL_DOWN"];

/**
 * The type a property is edited with. A GPIO property not set yet (rdy-gpios, reset-gpios) the
 * CLI gives as its controller alone (enum(gpio | expgpio)): the pin and the flags follow from the
 * controller's #gpio-cells, which it reads once one is written. Most controllers take two, so it
 * is edited as the row it will be: controller, pin, flags.
 */
export function edit_type(name, type, value) {
	if (value === undefined && /(^|-)gpios?$/.test(name) && type?.kind === "enum") {
		return { kind: "tuple", items: [type, { kind: "number", subtype: "int" }, { kind: "enum", options: GPIO_FLAGS.map(flag => ({ value: flag })) }] };
	}
	return type;
}

/** A negative as read's `written` has it: (-1). */
const negative = item => typeof item === "string" && /^\(-[0-9a-fx]+\)$/i.test(item);

/**
 * A property's value as its fields show it: read's `written` where it gives one (each number in the
 * base the file writes it, 0x53 or 83: READ-054), else its `value`. A negative is written (-1), which
 * update doesn't take: it is shown -1, as it is typed. What is a number, a reference or a string is
 * the `value`'s to say: this is the text only.
 */
export function written_value(property) {
	if (property?.written === undefined) {
		return property?.value;
	}
	const typed = item => {
		if (Array.isArray(item)) {
			return item.map(cell => typed(cell));
		}
		return negative(item) ? item.slice(1, -1) : item;
	};
	return typed(property.written);
}

/** A number's value, whatever its base (0x53, 83, -1); undefined for anything else (a macro, a label). */
function number_of(text) {
	const word = String(text ?? "").trim();
	if (!/^-?(0x[0-9a-f]+|[0-9]+)$/i.test(word)) {
		return;
	}
	return word.startsWith("-") ? -BigInt(word.slice(1)) : BigInt(word);
}

/** The choice among `options` that is the number `cell` is, in another base (2 for 0x2), if any. */
export function same_number(options, cell) {
	const number = number_of(cell);
	return number === undefined ? undefined : options.find(option => number_of(option) === number);
}

/** The cells of a value as read gives it, flat: numbers as text, a reference without its &. */
function cells_of(value) {
	if (value === undefined || value === null || value === true) return [];
	return (Array.isArray(value) ? value.flat(8) : [value]).map(cell => typeof cell === "string" ? cell.replace(/^&/, "") : String(cell));
}

/**
 * A number's other representation, for the ghost at a number field's right edge: decimal typed,
 * its hex; hex typed, its decimal. Nothing for anything else: a macro, a `&label`, an expression,
 * a negative or a 0-led (octal to dtc) number, several numbers, an empty field.
 */
export function other_number(text) {
	const word = String(text ?? "").trim();
	if (/^0x[0-9a-f]+$/i.test(word)) return BigInt(word).toString(10);
	if (/^(0|[1-9][0-9]*)$/.test(word)) return `0x${BigInt(word).toString(16)}`;
	return "";
}

/** A number field: the field, then its ghost (other_number), which sync_ghost keeps as it is typed. */
export function with_ghost(field, value, extra = "") {
	return `<span class="lx-num${extra ? ` ${extra}` : ""}">${field}<span class="lx-ghost" aria-hidden="true">${esc(other_number(value))}</span></span>`;
}

/**
 * A number field's ghost after its value changed (typed, put back): the other representation, and
 * room for it at the field's right edge. A list's cell (reg's) widens to hold both.
 */
export function sync_ghost(input) {
	const ghost = input.nextElementSibling;
	if (ghost === null || !ghost.classList.contains("lx-ghost")) return;
	const text = other_number(input.value);
	ghost.textContent = text;
	input.style.paddingRight = text === "" ? "" : `calc(${text.length}ch + 14px)`;
	const wrap = input.parentElement;
	if (wrap?.closest(".lx-cells.lx-list") && wrap.classList.contains("lx-cell-wrap")) {
		wrap.style.width = text === "" ? "" : `max(88px, calc(${input.value.trim().length + text.length}ch + 28px))`;
	}
}

/** What a select of labels ends with: a separator, then one entry per kind of node that can be added for it (`create:<compatible>`). */
export const CREATE = "create:";
export function create_options(kinds) {
	if (kinds.length === 0) return "";
	return `<option value="" disabled class="lx-create-sep">──────────</option>${kinds.map(kind => `<option value="${esc(CREATE + kind)}" class="lx-create">＋ Add a ${esc(kind)}…</option>`).join("")}`;
}

/**
 * A field that may hold a label, with its link under it, at its right: "go to <label>", shown
 * while the field holds one that exists (the controller's sync_go, which finds it by this wrap),
 * and it opens that node. `extra`: the wrap's own classes (a cell's, lx-cell-wrap), whose link
 * keeps its place hidden, so a grid's rows stay as high as each other as the user types.
 */
export function with_go(field, extra = "") {
	return `<span class="lx-go-field${extra ? ` ${extra}` : ""}">${field}<button type="button" class="lx-go" data-act="go-label" hidden></button></span>`;
}

/** A position's kind (a choice, a number, …): the columns of a row are headed when they differ. */
const kind_of = position => position?.kind ?? "value";

/**
 * What each cell of a row is, where the GUI knows the property: a GPIO's controller, pin and
 * flags (a *-gpios row, <&gpio 24 GPIO_ACTIVE_LOW>); a clock's provider and the cells its
 * #clock-cells asks for (clocks = <&clocks 20>: the CLI shapes the row once the provider is
 * written); an interrupt's pin, on a GPIO controller (`parent`: interrupt-parent's value), or
 * line, and its trigger (interrupts of two cells). Undefined otherwise: the headings are the
 * cells' numbers.
 */
function cell_names(name, width, parent = "") {
	if (/(^|-)gpios?$/.test(name) && width >= 2 && width <= 3) return ["controller", "pin", "flags"].slice(0, width);
	if (name === "clocks" && width >= 2) return ["provider", ...Array.from({ length: width - 1 }, (_cell, at) => `cell ${at + 1}`)];
	if (name === "interrupts" && width === 2) return [/gpio/.test(parent) ? "pin" : "line", "trigger"];
	return undefined;
}

/** The name a number has among a position's choices, when it is a macro the GUI knows. */
function macro_of(position, cell) {
	if (position?.kind !== "enum" || cell === "" || Number.isNaN(Number(cell))) return undefined;
	return (position.options ?? []).map(option => String(option.value)).find(name => MACROS[name] === Number(cell));
}

/**
 * One cell's field. A position whose binding lists its values is a dropdown of them; a number the
 * read gives for one of the macros the GUI knows is shown as that macro, one that is a choice in
 * another base (0x2 for 2) as that choice, any other value as itself (kept, so the dropdown never
 * drops what is stored). Otherwise a field to type in, a
 * number's with its ghost. `label`: the cell is a label (a phandle's): its dropdown ends with the
 * nodes that can be added for it (`creatable`), even when it lists none yet, and its link under
 * it goes to it (with_go).
 */
function cell_field(position, cell, { label = false, creatable = [] } = {}) {
	const options = position?.kind === "enum" ? (position.options ?? []).map(option => String(option.value)) : [];
	const creating = label ? creatable : [];
	if (options.length > 0 || creating.length > 0) {
		const chosen = macro_of(position, cell) ?? (options.includes(cell) ? cell : same_number(options, cell) ?? cell);
		const extra = chosen !== "" && !options.includes(chosen) ? [chosen] : [];
		const select = `<select class="lx-cell${label ? " lx-labels" : ""}">
			<option value=""${chosen === "" ? " selected" : ""} disabled>— choose —</option>
			${[...options, ...extra].map(option => `<option value="${esc(option)}"${option === chosen ? " selected" : ""}>${esc(option)}</option>`).join("")}
			${create_options(creating)}
		</select>`;
		return label ? with_go(select, "lx-cell-wrap") : `<span class="lx-cell-wrap">${select}</span>`;
	}
	const input = `<input class="lx-cell${label ? " lx-labels" : ""}" value="${esc(cell)}" spellcheck="false">`;
	if (label) return with_go(input, "lx-cell-wrap");
	return position?.kind === "number" ? with_ghost(input, cell, "lx-cell-wrap") : `<span class="lx-cell-wrap">${input}</span>`;
}

/**
 * The editor of a property whose type has a shape (shape_of), as HTML: a grid of cells whose
 * columns line up from row to row. A list of single cells (reg) is a row of fields with ＋ at its
 * end. A tuple or a matrix has a heading per column (its number); rows the count of which is free
 * are numbered, each with its ✕, and ＋ Add Row under them, until the binding's most (fit_rows); a heading names what the cell is where
 * the GUI knows it (cell_names: `parent` is interrupt-parent's value). A note says when the value
 * no longer fits the shape. `links.labels`: the property is a phandle's, so the first cell of each
 * row is a label (cell_field's `label`), with `links.creatable`, the nodes that can be added for it.
 * `value` is the property's as its fields show it (written_value): its cells hold that text, and a
 * change sends every cell as it holds it, so the cells not edited keep the base they were written in.
 */
export function cells_editor(name, type, value, { base = false, parent = "", links = { labels: false, creatable: [] } } = {}) {
	const shape = shape_of(type);
	const row_cells = value_rows(shape, value);
	// The grid's width: the binding's row, or the value's longest row where it is longer (a loose
	// matrix's rows, reg = <a b>; a phandle's arguments its provider's #…-cells asks for, which the
	// binding can't know: clocks = <&clocks 20>), the extra cells numbers.
	const longest = Math.max(0, ...row_cells.map(row => row.length));
	if (shape.loose && longest > 1) shape.positions = Array.from({ length: longest }, () => shape.inner);
	else if (shape.grouped && longest > shape.positions.length) {
		shape.positions = [...shape.positions, ...Array.from({ length: longest - shape.positions.length }, () => ({ kind: "number" }))];
	}
	const width = shape.positions.length;
	const cells = row_cells.flat();
	const fixed = typeof shape.rows === "number" ? shape.rows : undefined;
	const rows = fixed ?? Math.max(shape.rows.min, row_cells.length);
	const expected = fixed === undefined ? undefined : fixed * width;
	const fits = cells.length === 0 || (expected === undefined ? (shape.grouped ? true : cells.length % width === 0) : cells.length === expected);
	const free = fixed === undefined;
	const list = width === 1 && free;
	// Headings when the columns differ (a tuple) or there are rows of several cells (a matrix).
	const mixed = new Set(shape.positions.map(kind_of)).size > 1;
	const heads = width > 1 && (mixed || rows > 1 || free);
	const numbered = free && !list;
	const removable = row => free && rows > shape.rows.min && row >= 0;
	const html = [];
	if (heads) {
		const names = cell_names(name, width, parent);
		html.push(`<div class="lx-row lx-cells-head" aria-hidden="true">${numbered ? `<span class="lx-row-index"></span>` : ""}${shape.positions.map((_position, at) => `<span title="Cell ${at + 1}">${esc(names?.[at] ?? `Cell ${at + 1}`)}</span>`).join("")}${numbered ? `<span></span>` : ""}</div>`);
	}
	for (let row = 0; row < rows; row++) {
		const these = row_cells[row] ?? [];
		html.push(`<div class="lx-row">${numbered ? `<span class="lx-row-index">${row}</span>` : ""}${shape.positions.map((position, at) => cell_field(position, these[at] ?? "", { label: links.labels && shape.grouped && at === 0, creatable: links.creatable })).join("")}
			${removable(row) ? `<button class="icon lx-row-remove" data-act="cells-remove" title="Remove this ${list ? "cell" : "row"}">✕</button>` : numbered ? `<span></span>` : ""}</div>`);
	}
	const note = fits ? "" : `<div class="lx-shape-note">The value has ${cells.length} cell${cells.length === 1 ? "" : "s"}; the binding now expects ${expected ?? `a multiple of ${width}`}${name === "interrupts" ? " (its shape follows interrupt-parent)" : ""}. Set it again to fit.</div>`;
	const layout = list ? "lx-list" : `lx-grid${numbered ? " numbered" : ""}`;
	// The columns: a choice (a macro, a label) wider than a number, so its names show whole.
	const template = shape.positions.map(position => position?.kind === "enum" ? "minmax(0, 2fr)" : "minmax(0, 1fr)").join(" ");
	return `<div class="lx-cells ${layout}${base ? " base" : ""}" data-edit="cells" data-prop="${esc(name)}" data-width="${width}"${fixed === undefined ? "" : ` data-fixed="${fixed}"`}${shape.grouped ? ` data-grouped="1"` : ""}${free && shape.rows.max !== undefined ? ` data-max="${shape.rows.max}"` : ""} style="--lx-cols:${width}; --lx-template:${template}">
		${html.join("")}
		${free ? `<button class="ghost lx-row-add" data-act="cells-add"${shape.rows.max !== undefined && rows >= shape.rows.max ? " hidden" : ""} title="Add a ${list ? "cell" : `row of ${width} cells`}">＋ ${list ? "Cell" : "Row"}</button>` : ""}
		${note}
	</div>`;
}

/**
 * A value's rows, each its cells as text (cells_of). read gives several rows nested and one row
 * flat, and a row of one cell flat too: <&clk_osc>, <&clk_usb> reads ["&clk_osc", "&clk_usb"], as
 * <&clocks 20> reads ["&clocks", 20]. So where each row is its own cell array (grouped), a flat
 * value's rows start at its references (a phandle and its arguments); a loose matrix's flat value
 * is one row; and plain cells fill rows of the binding's width.
 */
function value_rows(shape, value) {
	if (value === undefined || value === null || value === true) return [];
	const list = Array.isArray(value) ? value : [value];
	if (list.length > 0 && list.every(row => Array.isArray(row))) return list.map(row => cells_of(row));
	const cells = cells_of(list);
	if (shape.loose) return cells.length === 0 ? [] : [cells];
	if (shape.grouped && list.some((cell, at) => at > 0 && typeof cell === "string" && cell.startsWith("&"))) {
		const rows = [];
		for (const [at, cell] of list.entries()) {
			if (at === 0 || (typeof cell === "string" && cell.startsWith("&"))) rows.push([]);
			rows.at(-1).push(cells[at]);
		}
		return rows;
	}
	if (shape.grouped) return cells.length === 0 ? [] : cells.length > shape.positions.length ? [cells] : chunk(cells, shape.positions.length);
	return chunk(cells, shape.positions.length);
}

const chunk = (cells, width) => Array.from({ length: Math.ceil(cells.length / width) }, (_, row) => cells.slice(row * width, (row + 1) * width));

/** A new empty row for an editor (cells-add): one field per position of the first row, numbered next. */
export function empty_row(editor) {
	const rows = editor.querySelectorAll(".lx-row:not(.lx-cells-head)");
	const row = rows[0].cloneNode(true);
	for (const input of row.querySelectorAll("input")) {
		input.value = "";
		input.style.paddingRight = "";
	}
	for (const select of row.querySelectorAll("select")) select.value = "";
	// Empty: no ghost, no link to a label.
	for (const ghost of row.querySelectorAll(".lx-ghost")) ghost.textContent = "";
	for (const wrap of row.querySelectorAll(".lx-cell-wrap")) wrap.style.width = "";
	for (const go of row.querySelectorAll(".lx-go")) go.hidden = true;
	const index = row.querySelector(".lx-row-index");
	if (index !== null) index.textContent = String(rows.length);
	if (row.querySelector('[data-act="cells-remove"]') === null) {
		// The row's last slot (an empty span when it had no ✕) takes the ✕.
		const slot = row.lastElementChild?.tagName === "SPAN" && !row.lastElementChild.classList.contains("lx-cell-wrap") ? row.lastElementChild : null;
		const button = `<button class="icon lx-row-remove" data-act="cells-remove" title="Remove this ${editor.classList.contains("lx-list") ? "cell" : "row"}">✕</button>`;
		if (slot !== null) slot.outerHTML = button;
		else row.insertAdjacentHTML("beforeend", button);
	}
	return row;
}

/** An editor's ＋ after a row is added or removed: gone once it has as many rows as the binding allows (data-max). */
export function fit_rows(editor) {
	const add = editor.querySelector(".lx-row-add");
	if (add === null || editor.dataset.max === undefined) return;
	add.hidden = editor.querySelectorAll(".lx-row:not(.lx-cells-head)").length >= Number(editor.dataset.max);
}

/**
 * The words of an editor's cells, in order, for update: `{ words }`, `{ clear: true }` when every
 * cell is empty, or `{ incomplete: true }` while some are still to fill. Where each row is its own
 * cell array (data-grouped), a row's last word ends with `,`: update's value has its rows
 * separated by `,` (GRM-070), and writes `<&gpio 8 1>, <&gpio 7 1>` rather than one array.
 * `put` (`{ field, value }`): that cell taken as holding `value` (a node just added for it).
 */
/**
 * A clocks row's provider just changed (`field`, its first cell): the cells after it are the old
 * provider's #clock-cells, so they go, and the row is written as the provider alone; the CLI then
 * shapes it by the new one's #clock-cells (two steps, as list property's type of the row says).
 * True when it dropped any.
 */
export function drop_provider_cells(field) {
	const editor = field.closest?.(`.lx-cells[data-prop="clocks"][data-grouped="1"]`);
	const row = field.closest?.(".lx-row");
	if (!editor || !row || row.querySelector(".lx-cell") !== field) return false;
	const after = [...row.querySelectorAll(".lx-cell")].slice(1);
	for (const cell of after) (cell.closest(".lx-cell-wrap") ?? cell).remove();
	return after.length > 0;
}

export function cell_words(editor, put) {
	const rows = [...editor.querySelectorAll(".lx-row:not(.lx-cells-head)")]
		.map(row => [...row.querySelectorAll(".lx-cell")].map(field => (put !== undefined && field === put.field ? put.value : field.value ?? "").trim()))
		.filter(row => row.length > 0);
	const values = rows.flat();
	if (values.every(value => value === "")) return { clear: true };
	if (values.some(value => value === "")) return { incomplete: true };
	if (editor.dataset.grouped !== "1") return { words: values };
	return { words: rows.flatMap((row, at) => at < rows.length - 1 ? [...row.slice(0, -1), `${row.at(-1)},`] : row) };
}

// Where a node is in a devicetree source (the overlay, or the full .dts a build wrote): its
// lines, for the right column to scroll to the node open. Each node block of the text, with
// the path in the merged tree it writes to:
//
//   &spi0 {                                 /soc/spi@7e204000        (spi0 by its label)
//   	adc: adi,ad7124-8@0 { … };           /soc/spi@7e204000/adi,ad7124-8@0
//   &{/soc/spi@7e204000} { … };             /soc/spi@7e204000
//   fragment@0 { target = <&spi0>; __overlay__ { … }; };   __overlay__: spi0's path
//   / { soc { … }; };                       /, /soc (the full .dts)
//
// Read line by line, as the CLI writes a source (each node on lines of its own, a one-line node
// too); comments and strings set aside. No DOM here, so its test runs in Node
// (source-nodes.test.mjs, in the CLI's vitest).

const child_path = (path, key) => path === "/" ? `/${key}` : `${path}/${key}`;

/** A node opened (`labels: name {`, `&label {`, `&{/path} {`, `/ {`), or a block closed. */
const TOKEN = /(?:[A-Za-z_]\w*:\s*)*(\/|&\{[^}]*\}|&[A-Za-z_]\w*|[\w,.+@-]+)\s*\{|\}/g;

/**
 * The node blocks of `text`: `{ path, start, end }`, the lines (from 0) of its opening and its
 * closing, in the order they close. `resolve(label)`: the path of the node a label names, or
 * undefined (a block on a label not known has no path, nor have the blocks in it).
 */
export function source_nodes(text, resolve) {
	const blocks = [];
	const open = [];
	let comment = false;
	for (const [at, raw] of text.split("\n").entries()) {
		// A fragment's target, given in a property of its own.
		const top = open.at(-1);
		const target = /^\s*target\s*=\s*<\s*&([A-Za-z_]\w*)\s*>/.exec(raw)?.[1];
		const target_path = /^\s*target-path\s*=\s*"([^"]*)"/.exec(raw)?.[1];
		if (top !== undefined && target !== undefined) top.target = resolve(target);
		if (top !== undefined && target_path !== undefined) top.target = target_path;
		let line = raw;
		if (comment) {
			const end = line.indexOf("*/");
			if (end === -1) continue;
			line = line.slice(end + 2);
			comment = false;
		}
		line = line.replaceAll(/\/\*.*?\*\//g, "").replaceAll(/"(?:[^"\\]|\\.)*"/g, "\"\"").replace(/\/\/.*$/, "");
		const start = line.indexOf("/*");
		if (start !== -1) {
			line = line.slice(0, start);
			comment = true;
		}
		for (const [token, name] of line.matchAll(TOKEN)) {
			if (token === "}") {
				const block = open.pop();
				if (block !== undefined) blocks.push({ path: block.path, start: block.start, end: at });
				continue;
			}
			const parent = open.at(-1);
			let path;
			if (name.startsWith("&{")) path = name.slice(2, -1);
			else if (name.startsWith("&")) path = resolve(name.slice(1));
			else if (parent === undefined) path = name === "/" ? "/" : undefined;
			else if (name === "__overlay__") path = parent.target;
			else if (parent.path !== undefined) path = child_path(parent.path, name);
			open.push({ path, start: at });
		}
	}
	return blocks;
}

/** The lines of the first block of `text` that writes to `path` (`{ start, end }`), or undefined. */
export function node_lines(text, path, resolve) {
	let first;
	for (const block of source_nodes(text, resolve)) {
		if (block.path === path && (first === undefined || block.start < first.start)) first = block;
	}
	return first === undefined ? undefined : { start: first.start, end: first.end };
}

/**
 * The lines of `after` (from 0) that `before` doesn't have where they are: what a change wrote,
 * by a line diff (the longest common subsequence of the lines, the same start and end set aside
 * first). A change that only took lines away has none.
 */
export function changed_lines(before, after) {
	const old = before.split("\n");
	const now = after.split("\n");
	let head = 0;
	while (head < old.length && head < now.length && old[head] === now[head]) head++;
	let tail = 0;
	while (tail < old.length - head && tail < now.length - head && old[old.length - 1 - tail] === now[now.length - 1 - tail]) tail++;
	const a = old.slice(head, old.length - tail);
	const b = now.slice(head, now.length - tail);
	// common[i][j]: the longest common subsequence of a[i..] and b[j..].
	const common = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
	}
	const changed = [];
	let i = 0;
	let j = 0;
	while (j < b.length) {
		if (i < a.length && a[i] === b[j]) {
			i++;
			j++;
		} else if (i < a.length && common[i + 1][j] >= common[i][j + 1]) {
			i++;
		} else {
			changed.push(head + j);
			j++;
		}
	}
	return changed;
}

// `--help --all`: every command's help, for every backend a project may pick (and the active
// one, `FrontEnd.choices`), as one Markdown
// document. The pages are the routes' own `--help` (and a group's, `list --help`), rendered
// through the same application as `--help`, so the document can't drift from the help. A page
// the backends render alike is printed once; one that differs, once per backend.

import { build_routes, type FrontEnd } from "./routes";

/** `--help` of `words` (`[]`: the root) as `front` prints it. */
export type HelpOf = (front: FrontEnd, words: readonly string[]) => Promise<string>;

interface Page {
	/** `[]` for the root, `["list"]`, `["list", "devices"]`. */
	path: readonly string[];
	/** The help of each backend that has the page, by backend id. */
	texts: Map<string, string>;
}

/** The front end with `id`'s backend active in place of the configured one. */
async function front_with(front: FrontEnd, id: string): Promise<FrontEnd> {
	const backend = await front.registry[id]!();
	const { backend_problem: _, ...rest } = front;
	return { ...rest, backend };
}

/** The pages of one backend, in the order of help: the root, then each command, a group before its commands. */
function paths_of(front: FrontEnd, prefix: readonly string[]): string[][] {
	const paths: string[][] = prefix.length === 0 ? [[]] : [];
	const seen = new Set<string>();
	for (const route of build_routes(front)) {
		if (route.hidden === true) { continue; }
		if (!prefix.every((word, index) => route.path[index] === word)) { continue; }
		for (let length = Math.max(1, prefix.length); length <= route.path.length; length++) {
			const path = route.path.slice(0, length);
			const key = path.join(" ");
			if (!seen.has(key)) {
				seen.add(key);
				paths.push([...path]);
			}
		}
	}
	return paths;
}

/** The pages of every backend, merged: a page one backend lacks goes after the one before it in that backend's order. */
async function collect(front: FrontEnd, prefix: readonly string[], help_of: HelpOf): Promise<Page[]> {
	const pages: Page[] = [];
	for (const id of front.choices) {
		const variant = await front_with(front, id);
		let after = -1;
		for (const path of paths_of(variant, prefix)) {
			const key = path.join(" ");
			let index = pages.findIndex(page => page.path.join(" ") === key);
			if (index === -1) {
				index = after + 1;
				pages.splice(index, 0, { path, texts: new Map() });
			}
			const text = await help_of(variant, path);
			pages[index]!.texts.set(id, text.trimEnd());
			after = index;
		}
	}
	return grouped(pages);
}

/** The pages with each command's own (a group's) right after it, in the order they came. */
function grouped(pages: readonly Page[]): Page[] {
	const within = (page: Page, parent: readonly string[]): boolean =>
		page.path.length === parent.length + 1 && parent.every((word, index) => page.path[index] === word);
	const under = (parent: readonly string[]): Page[] => pages.flatMap(page => within(page, parent) ? [page, ...under(page.path)] : []);
	const top = Math.min(...pages.map(page => page.path.length));
	return pages.flatMap(page => page.path.length === top ? [page, ...under(page.path)] : []);
}

/** GitHub's anchor of a heading: lower case, spaces to hyphens, punctuation dropped. */
function anchor(heading: string): string {
	return heading.toLowerCase().replaceAll(/[^a-z0-9 -]/g, "").replaceAll(" ", "-");
}

function block(text: string): string {
	return `\`\`\`text\n${text}\n\`\`\``;
}

/** One page: its help once when every backend that has it renders it alike, else once per backend. */
function render_page(page: Page, heading: string, ids: readonly string[]): string {
	const has = ids.filter(id => page.texts.has(id));
	const texts = new Set(page.texts.values());
	const only = has.length < ids.length ? `Only where the backend is ${has.join(" or ")}.\n\n` : "";
	if (texts.size === 1) { return `## ${heading}\n\n${only}${block([...texts][0]!)}`; }
	return `## ${heading}\n\n${only}${has.map(id => `### ${heading} (${id})\n\n${block(page.texts.get(id)!)}`).join("\n\n")}`;
}

/** The document: a title, the contents, then every page under `prefix` (`[]`: all of them). Undefined when no backend has a command there. */
export async function help_all(front: FrontEnd, prefix: readonly string[], help_of: HelpOf): Promise<string | undefined> {
	const ids = front.choices;
	const pages = await collect(front, prefix, help_of);
	if (pages.length === 0) { return undefined; }
	const heading = (page: Page): string => [front.program, ...page.path].join(" ");
	const title = prefix.length === 0 ? `${front.program} commands` : `${heading({ path: prefix, texts: new Map() })} commands`;
	const contents = pages.map(page => `${"  ".repeat(Math.max(0, page.path.length - 1))}- [${heading(page)}](#${anchor(heading(page))})`);
	return [
		`# ${title}`,
		`The help of every command, for every backend (${ids.join(", ")}): what \`--help\` prints. Where the backends differ, each has its own. Made by \`${front.program} ${[...prefix, "--help", "--all"].join(" ")}\`, version ${front.version}.`,
		`## Contents\n\n${contents.join("\n")}`,
		...pages.map(page => render_page(page, heading(page), ids)),
	].join("\n\n") + "\n";
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const page = (...path: string[]): Page => ({ path, texts: new Map() });

	test("grouped - a group's commands right after it, whichever backend added them last", () => {
		const order = grouped([page(), page("list"), page("list", "devices"), page("deploy"), page("generate"), page("list", "parent")]);
		expect(order.map(each => each.path.join(" "))).toEqual(["", "list", "list devices", "list parent", "deploy", "generate"]);
		expect(grouped([page("list"), page("list", "devices")]).map(each => each.path.join(" "))).toEqual(["list", "list devices"]);
	});

	test("anchor - as GitHub makes it", () => {
		expect(anchor("analog-attach list devices")).toBe("analog-attach-list-devices");
	});

	test("render_page - once when alike, per backend when not, and where it is only in some", () => {
		const alike = { path: ["init"], texts: new Map([["linux", "A"], ["noos", "A"]]) };
		expect(render_page(alike, "aa init", ["linux", "noos"])).toBe("## aa init\n\n```text\nA\n```");
		const differ = { path: ["deploy"], texts: new Map([["linux", "L"], ["noos", "N"]]) };
		expect(render_page(differ, "aa deploy", ["linux", "noos"])).toBe("## aa deploy\n\n### aa deploy (linux)\n\n```text\nL\n```\n\n### aa deploy (noos)\n\n```text\nN\n```");
		const only = { path: ["generate"], texts: new Map([["noos", "G"]]) };
		expect(render_page(only, "aa generate", ["linux", "noos"])).toBe("## aa generate\n\nOnly where the backend is noos.\n\n```text\nG\n```");
	});
}

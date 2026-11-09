// What every part of the GUI uses: running the CLI through the server, the console, the toast,
// and escaping. The core (app.mjs) and each ecosystem's part (../ecosystems/<id>/controller.mjs)
// import these, and nothing else of each other.

export const $ = id => document.getElementById(id);
export const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const shell_quote = arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;

/** The secret the server put in the page: every API call carries it (server.mjs). */
const TOKEN = document.querySelector('meta[name="aa-token"]')?.content ?? "";

/** A call to the server's API: JSON in, the response as it comes. */
export function api(path, body) {
	const headers = { "x-aa-token": TOKEN };
	if (body === undefined) return fetch(path, { headers });
	return fetch(path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function log(html) {
	const out = $("console");
	out.insertAdjacentHTML("beforeend", html);
	out.scrollTop = out.scrollHeight;
}

/** Run `analog-attach ...args`: { code, stdout, stderr, json }. `quiet` keeps a read out of the console. */
export async function cli(args, { quiet = false } = {}) {
	if (!quiet) log(`<div class="cmd">$ analog-attach ${esc(args.map(shell_quote).join(" "))}</div>`);
	const response = await api("/api/run", { args });
	const result = await response.json();
	if (!quiet) {
		const text = result.json?.message ?? `${result.stdout ?? ""}${result.stderr ?? result.error ?? ""}`.trimEnd();
		log(`<div class="${result.code === 0 ? "" : "fail"}">${esc(text)}</div>`);
	}
	return result;
}

/** Run a long command (build, deploy), its output into the console as it comes; the exit code. */
export async function stream(args) {
	log(`<div class="cmd">$ analog-attach ${esc(args.map(shell_quote).join(" "))}</div>`);
	$("footer").classList.remove("collapsed");
	const response = await api("/api/stream", { args });
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const out = $("console");
	const block = document.createElement("div");
	out.append(block);
	let text = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
		block.textContent = text.split("\u0000exit")[0];
		out.scrollTop = out.scrollHeight;
	}
	const code = Number(text.split("\u0000exit ")[1] ?? -1);
	log(`<div class="${code === 0 ? "okl" : "fail"}">${code === 0 ? "✔ done" : `✘ exited with ${code}`}</div>`);
	toast(code === 0 ? `${args[0]} finished` : `${args[0]} failed (exit ${code})`, code !== 0);
	return code;
}

export function first_line(text) {
	return (text ?? "").split("\n").find(line => line.trim() !== "")?.trim() ?? "Done";
}

let toast_timer;
export function toast(text, error = false) {
	const box = $("toast");
	box.textContent = text;
	box.className = `toast show${error ? " err" : ""}`;
	clearTimeout(toast_timer);
	toast_timer = setTimeout(() => { box.className = "toast"; }, 3500);
}

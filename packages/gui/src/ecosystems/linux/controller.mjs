// The Linux part of the GUI: a placeholder, to be built. The core (../../core/app.mjs) mounts it
// on a project whose backend is linux, after the project setup. See ../README.md for what a
// part is given and gives back, and ../noos/controller.mjs for a full one.

import { cli, esc } from "../../core/ui.mjs";

export const title = "Linux";
export const about = "Device tree overlays for a Linux board (Raspberry Pi and others).";
/** What the project setup asks for (in order), then offers as optional, for a Linux project. */
export const setup = {
	keys: ["linux", "devicetree", "workfile"],
	titles: { linux: "Linux tree", devicetree: "Base devicetree", workfile: "Workfile" },
	optional: ["overlay-syntax"],
};

/** Draw the Linux part in `context.main`, for `context.project`. */
export async function mount(context) {
	const draw = async () => {
		const result = await cli(["config", "--json"], { quiet: true });
		const configs = result.json?.configs ?? [];
		const value = key => configs.find(config => config.field_name === key)?.value;
		context.set_chips(value("devicetree") ? `⌂ ${String(value("devicetree")).split("/").pop()}` : "no base", { text: "Linux", kind: "" });
		context.main.style.display = "block";
		context.main.innerHTML = `<section class="content"><div class="card empty">
			<h2>A Linux project</h2>
			<p>The Linux part of this GUI is still to be built. The project's settings are saved; meanwhile, the CLI does the rest:</p>
			<p><code>analog-attach list devices</code> · <code>analog-attach add &lt;compatible&gt; --parent &lt;node&gt;</code> · <code>analog-attach validate</code> · <code>analog-attach build</code></p>
			<table style="max-width:640px;margin:16px auto;text-align:left">${["linux", "devicetree", "workfile"].map(key => `<tr><td class="key">${esc(key)}</td><td class="mono">${esc(value(key) ?? "(not set)")}</td></tr>`).join("")}</table>
			<button data-act="linux-setup">Project setup</button>
		</div></section>`;
		context.main.querySelector('[data-act="linux-setup"]').onclick = () => context.open_setup();
	};
	await draw();
	return { refresh: draw };
}

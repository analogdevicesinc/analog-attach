# The ecosystems' parts of the GUI

The GUI has a **core** (`../core/`) and one **part per ecosystem** here: `noos/`, `linux/`. Each
part is its owner's to change; the core is shared.

- **The core** (`core/app.mjs`) draws the header (the project folder, Open, New project, Setup),
  the console with its **command line** (any `analog-attach` command, as on a terminal), the
  **chat with the assistant** (`core/chat.mjs`), and the **project setup** (`core/setup.mjs`). A folder with no project settings
  (no `.analog-attach/config.json`), or one still missing a required setting, gets the setup:
  the ecosystem, then the settings its part asks for, then its optional settings. After that, and for a project set up already, the
  core **mounts the part** of the project's backend in `<main>`.
- **A part** draws everything below the header for its ecosystem's projects: its menu (noos; the
  linux part has none), views and events. Two parts never share code; what both need goes to the
  core (`core/ui.mjs`).

## What a part is: `<backend>/controller.mjs`

An ES module, named after the `backend` setting's value, that exports:

```js
export const title = "Linux";                       // on the setup's ecosystem card
export const about = "Device tree overlays for ..."; // under it
export const setup = {
	keys: ["linux", "devicetree"],               // what the setup asks for, in order
	titles: { linux: "Linux tree", optional: "Overlay" }, // the steps' names (the key when left out; optional: the last step, More settings when left out)
	optional: ["workfile", "output"],            // offered together, after
	// Each optional, by setting, to add to its step (core/setup.mjs, SETUP_HOOKS):
	description: { linux: "Path to …" },         // in place of the CLI's description
	help: { linux: "<p>None yet? …</p>" },        // HTML under the setting's description
	found: { linux: async ({ api }) => [{ value, display_string }] },  // beside what the CLI found
	choices: { devicetree: async ({ cli }) => [{ value, label, detail, note }] },  // to filter and pick
	empty: { workfile: ({ dir }) => `${dir}/overlay.dtso` },  // saved when the field is left empty
	refused: { linux: async (value, problem, { api }) => ({ text, value }) },  // a fix offered
	saving: { linux: "Saving… building the binding caches…" },  // shown while it is saved (a long one)
	names: { workfile: "overlay.dtso" },          // an optional path given as a file name in the project folder
	about: { "overlay-syntax": "<dl>…</dl>", output: "" }, // HTML in place of an optional setting's description (code, laid out); "": none
	start: { actions: [{ id, label, primary, saving, run: async ({ cli }) => ({ ok: true }) }] },
	                                              // the last step's buttons while there is no workfile, in Open Project's place:
	                                              // each saves the optional settings, then makes the workfile (undefined: cancelled);
	                                              // the step is done once there is one
};
export const toasts = false;                         // optional: no toasts in this part's projects, the core's included (linux)
export const console_options = false;                // optional: no console preferences in this part's projects (linux)

/** Draw the part. Called once per project; resolves with what the core calls after. */
export async function mount(context) {
	context.main.innerHTML = "...";
	return {
		refresh: async () => { /* read the project again and redraw */ },
		chat: {                                       // what the core's chat tells the model
			skill: "analog-attach-linux",               // Claude Code: offered for install when missing; another model: in its prompt
			hint: "<i>add an AD7124-8 on spi0</i>",      // examples in the empty chat
			context: () => "The user has ad7124_8 open.", // sent with each message
			dock: { place(panel, changed) {}, shown() {}, show() {}, hide() {} }, // optional: the panel in the part's screen
		},
	};
}
```

A part that puts its own button where the header's **Project Setup** is (linux: Deploy) resolves
with `setup_button: false` too: the core hides its button while the part is on screen, and the
setup stays in the preferences (About → Open Setup). With `setup_option: false` as well (linux),
the preferences don't offer the setup either.

A part that resolves with `project: { title, draw(box, { close }) }` (linux) makes the header's ⚙
one popup with two tabs: `title` (Project), first, then Preferences. `draw` fills `box`, the
Project tab, each time the popup opens; `close()` closes the popup. The linux part draws its
Project tab as a list of sections (`PROJECT_SECTIONS`, in its controller): the settings, the
system variables, the project variables, and the scripts.

The preferences' **Menu folded** (and the fold toggle at the menu's foot) are shown only when the
part has a menu (`<main>` has a `<nav>`): not in a Linux project.

With `export const console_options = false` (linux), the preferences have neither **Console
height** nor **Show the GUI's own reads**, and the console never shows the reads. With no menu
either, a Linux project's preferences have no Layout or Console section.

With `export const toasts = false` (linux), `toast()` does nothing while that part's project is
open, the core's toasts included (the end of a streamed command, Open With, New chat): what
happened is said in place, or in the console (`show_console()` opens it). A part that keeps
toasts (noos) is unchanged.

Without `dock`, the chat is the core's panel on the right of the page (noos). With it, the part
has the panel in its own screen (linux: the right column, a tab in the overlay's place): `place(panel, changed)` puts the core's panel there, once per mount, and `changed()` is
called whenever it comes on screen or leaves it; `shown()` says whether it is on screen; `show()`
and `hide()` are what the ✦ Assistant button does. During the setup the panel is the core's again.

The core calls `refresh()` after a command typed on the command line and after each command
the assistant runs, so the part's view follows the project whoever changed it.

`context` is what the core gives the part:

| Field | What it is |
|---|---|
| `main` | The part's element: a fresh `<main>` for each project. Draw in it, and put the part's listeners on it (or below), never on `document`. Its grid layout is the noos one by default; set `main.style` for another |
| `header_actions` | A `<span>` in the header for the part's own buttons (noos: Validate; linux: Validate, Build, Deploy) |
| `console_actions` | A `<span>` in the console bar, before the core's ✦ Assistant, Clear and Hide, for the part's buttons there |
| `project` | `{ dir, settings, backend }`: the folder, whether it has project settings, its backend |
| `set_chips(board, { text, kind }, action)` | The header's two chips: the board, and the status (`kind`: `ok`, `warn`, `err`). With `action` (`{ title, run }`), the board's chip is a button that runs it (linux: change the base devicetree) |
| `reload_project()` | After a change that may concern the core (a setting saved, the backend itself): the core reads the project again, and mounts another part when the backend changed |
| `open_setup()` | Show the project setup again |
| `open_preferences({ tab })` | Open the ⚙ popup, on its `"project"` or `"preferences"` tab (linux: back to the Project tab after a setting's step) |

To add an ecosystem, add its folder and its line in `ECOSYSTEMS` (`core/app.mjs`), and copy its
files into the CLI's bundle (the CLI's `build` script copies `ecosystems/` whole).

## What every part uses: `../core/ui.mjs`

| Export | What it does |
|---|---|
| `cli(args, { quiet })` | Run `analog-attach <args>` in the project; `{ code, stdout, stderr, json }`. Shown in the console unless `quiet` |
| `stream(args, { output, env })` | A long command (build, deploy), its output into the console as it comes; the exit code, or with `output: true` `{ code, text }` (a refusal exits 0 too: its text tells it apart). `env`: variables for that run alone (linux: Deploy's secrets), not shown in the console |
| `log(html)`, `toast(text, error)` | The console, and the message in the corner (nothing in a part with `toasts = false`) |
| `show_console()` | Open the console when it is folded (linux: a build's, a deploy's, a validation's outcome) |
| `use_toasts(on)`, `toasts_on()` | The core's: toasts on or off for the project open (app.mjs sets it from the part's `toasts`) |
| `use_console_options(on)`, `console_options_on()` | The core's: the console's preferences on or off for the project open (app.mjs sets it from the part's `console_options`) |
| `$`, `esc`, `shell_quote`, `first_line` | `getElementById`, HTML escaping, a word as the shell would need it, a text's first line |
| `linkify(text)` | A description as HTML: escaped, its http/https URLs links (new tab, `rel="noopener noreferrer"`), trailing punctuation left out. For what a binding or a setting says; not for a validation message, a schema id or a file path |
| `open_panel({ title, subtitle, body, wide, on_close })` | A panel sliding in from the right, over the page (adding a device): `{ body, close }`. Esc, ✕ or a click beside it closes it |
| `split_words(line)` | A command line's words, as a shell splits them (the core's command line) |
| `api(path, body)` | A call to the server's API with the page's token (the core's; a part should need `cli` only, and `/api/file` to show a file: linux, the Binding tab's YAML) |

And from `../core/setup.mjs`, `open_setting({ key, ecosystem, dir, title, saved, closed })`: one
setting's step of the setup, in a panel (its help, found values, list and field, from the part's
`setup`; `title`, else one from the step's), saved with `config`; then the panel closes and
`saved()` runs. `closed()` runs whenever the panel closes, saved or not, before `saved()` (linux:
the base devicetree, from its chip or the Project tab, and the Linux tree, from the Project tab,
which `closed` opens again).

Everything a part does is an `analog-attach` command through `cli` or `stream`, so the console
shows the user what ran, and the CLI checks every value. The server runs nothing else.

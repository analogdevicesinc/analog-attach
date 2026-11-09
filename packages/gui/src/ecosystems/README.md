# The ecosystems' parts of the GUI

The GUI has a **core** (`../core/`) and one **part per ecosystem** here: `noos/`, `linux/`. Each
part is its owner's to change; the core is shared.

- **The core** (`core/app.mjs`) draws the header (the project folder, Open, New project, Setup),
  the console, and the **project setup** (`core/setup.mjs`). A folder with no project settings
  (no `.analog-attach/config.json`) gets the setup, once: the ecosystem, then the settings its
  part asks for, then its optional settings. After that, and for a project set up already, the
  core **mounts the part** of the project's backend in `<main>`.
- **A part** draws everything below the header for its ecosystem's projects: its own menu,
  views and events. Two parts never share code; what both need goes to the core (`core/ui.mjs`).

## What a part is: `<backend>/controller.mjs`

An ES module, named after the `backend` setting's value, that exports:

```js
export const title = "Linux";                       // on the setup's ecosystem card
export const about = "Device tree overlays for ..."; // under it
export const setup = {
	keys: ["linux", "devicetree", "workfile"],   // what the setup asks for, in order
	titles: { linux: "Linux tree" },             // the steps' names (the key when left out)
	optional: ["overlay-syntax"],                // offered together, after
};

/** Draw the part. Called once per project; resolves with what the core calls after. */
export async function mount(context) {
	context.main.innerHTML = "...";
	return { refresh: async () => { /* read the project again and redraw */ } };
}
```

`context` is what the core gives the part:

| Field | What it is |
|---|---|
| `main` | The part's element: a fresh `<main>` for each project. Draw in it, and put the part's listeners on it (or below), never on `document`. Its grid layout is the noos one by default; set `main.style` for another |
| `header_actions` | A `<span>` in the header for the part's own buttons (noos: Validate) |
| `project` | `{ dir, settings, backend }`: the folder, whether it has project settings, its backend |
| `set_chips(board, { text, kind })` | The header's two chips: the board, and the status (`kind`: `ok`, `warn`, `err`) |
| `reload_project()` | After a change that may concern the core (a setting saved, the backend itself): the core reads the project again, and mounts another part when the backend changed |
| `open_setup()` | Show the project setup again |

To add an ecosystem, add its folder and its line in `ECOSYSTEMS` (`core/app.mjs`), and copy its
files into the CLI's bundle (the CLI's `build` script copies `ecosystems/` whole).

## What every part uses: `../core/ui.mjs`

| Export | What it does |
|---|---|
| `cli(args, { quiet })` | Run `analog-attach <args>` in the project; `{ code, stdout, stderr, json }`. Shown in the console unless `quiet` |
| `stream(args)` | A long command (build, deploy), its output into the console as it comes; the exit code |
| `log(html)`, `toast(text, error)` | The console, and the message in the corner |
| `$`, `esc`, `shell_quote`, `first_line` | `getElementById`, HTML escaping, a word as the shell would need it, a text's first line |
| `api(path, body)` | A call to the server's API with the page's token (the core's; a part should need `cli` only) |

Everything a part does is an `analog-attach` command through `cli` or `stream`, so the console
shows the user what ran, and the CLI checks every value. The server runs nothing else.

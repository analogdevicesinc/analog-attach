# Analog Attach documentation

The user guide of Analog Attach, written in reStructuredText and built with
[Sphinx](https://www.sphinx-doc.org/) and the ADI documentation tools
([adi-doctools](https://github.com/analogdevicesinc/doctools), theme `harmonic`).

## Build

Requires Python 3 with `venv`.

```sh
cd docs
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
make html
```

The result is in `_build/html`; open `_build/html/index.html` in a browser.

CI builds the documentation with warnings treated as errors. Check your changes
the same way before pushing:

```sh
make html SPHINXOPTS='-W --keep-going'
```

Remove the build output with `rm -rf _build`.

## Layout

Each chapter is a folder with an `index.rst`, listed in the `toctree` of
`index.rst`.

Pages that belong to one backend (the ecosystem a project targets) are kept in
a folder named after it, for example `ui-guide/linux/`. The `toctree` of the
chapter lists them, so the sidebar doesn't change. To document a new backend,
add a sibling folder and list its pages in the `toctree`.

| Folder | Content |
|---|---|
| `introduction/`, `install/`, `quick-start/`, `concepts/` | Overview and getting started |
| `ui-guide/` | The GUI (`analog-attach gui`) |
| `cli-guide/` | The command line |
| `ai-agents/` | Working with an AI agent |
| `use-cases/` | Step-by-step walkthroughs on real hardware; copy `use-cases/template.rst` to add one |
| `reference/` | Commands, JSON protocol, workfile, configuration file |
| `troubleshooting/` | Common problems |
| `sources/` | Logo, icon, CSS, placeholder image |

## Writing

- Parts that still need content are marked `.. todo::` with an owner. They are
  shown in the build (`todo_include_todos = True`). Replace each when you fill
  the section in, and don't leave an empty `.. todo::`.
- Figures: use `.. figure::` (it takes a caption; `.. image::` does not).
- Videos: `.. video:: <URL>` followed by a caption.
- Images and videos are not stored in this folder. `sources/placeholder.svg`
  stands in until the final location is decided.

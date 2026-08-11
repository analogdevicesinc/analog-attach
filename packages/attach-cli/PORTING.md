# Porting attach-cli off `dts_legacy` onto the new `dts/` AST

## Context

`attach-cli` currently drives all DTS/DTSO manipulation through the legacy stack
(`attach-lib/src/dts_legacy/` types + `attach-lib/src/dtso/` merge helpers),
consumed via `attach-lib`'s top-level re-exports. `attach-lib` has a newer
`src/dts/` AST and an ergonomic `DeviceTree` / `DeviceTreeOverlay` wrapper
(`src/Devicetree.ts`) built on it. The goal is to migrate `attach-cli` to the new
stack so the legacy parser can eventually be retired.

Gap analysis concluded the library is essentially ready:

- `get_node_key` → covered by `get_full_node_name` (`dts/ast.ts:47`)
- `print_value` (single property) → `print_property` (`dts/printer.ts:98`)
- `set_unit_addr` → **added** to `DeviceTree` this session
- Base-tree resolution → `overlay.get_base_dts()?.get_node_by_label()/get_node_by_path()`
- Fragment mutation → `get_fragments()` + `add_fragment()` compose; no new DTO API

Decision: keep the `DeviceTreeOverlay` API lean — the combined "search base +
overlay, is-it-in-base" logic lives in **CLI utilities**, not the library.

## Work already done

- `attach-lib/src/Devicetree.ts`: added `UnitAddr` type, `format_unit_addr_part`,
  and `set_unit_addr(target, addr)` (single or multi-part unit address, hex or dec,
  `undefined` clears; multi-part joins with `,` → `device@0,400`).
- `attach-lib/src/index.ts`: now exports the new `dts/` module, `DeviceTree`,
  `DeviceTreeOverlay`, `NodeBuilder`, `PropertyBuilder`. Legacy `dts_legacy`
  re-exports narrowed to explicit named exports (the `Dts*` types and legacy-only
  helpers) so the new names win on collision. Build is clean.

## Key architectural difference

**Legacy model:** `mergeDtso(base, overlayText, true)` yields ONE flat merged
`DtsDocument`; overlay-added content is flagged via `modified_by_user`; `printDtso`
emits only the delta. All command helpers mutate that single tree.

**New model:** base (`DeviceTree`) and overlay (`DeviceTreeOverlay`, holding a `DTO`
of `fragment@N { target=<&label>|target-path; __overlay__ { ... } }`) are SEPARATE.
No merged view, no `modified_by_user`. The overlay structure *is* the delta.
`DeviceTreeOverlay.new_from_string(content, base_dts)` accepts the base. The new
`parse_dto` accepts `&label { ... }` shorthand and normalizes to fragment form;
`print_dto` emits canonical fragment form (a file-format change on round-trip,
acceptable — both are valid overlay syntax).

## CLI utilities to build (`attach-cli/src/utilities.ts`)

Replace the legacy `resolve_node_identifier(document: DtsDocument, id)` and the
scattered `search_node_in_dts(merged, …)` / `search_node_in_dts(base, …)` calls
with helpers operating on `DeviceTree` + `DeviceTreeOverlay`:

1. `find_in_base(base: DeviceTree, identifier)` → `DTReference | undefined`
   - dispatch on identifier form: `&{/path}` / `/path` → `get_node_by_path`;
     `&label` / bare label → `get_node_by_label`.

2. `find_in_overlay(overlay, identifier)` → `{ node, path, parent_node?, is_in_base }`
   - Walk `overlay.get_fragments()`; for each fragment resolve its `target` (label)
     or `target-path` against the base to get the fragment's absolute base path,
     then traverse the `__overlay__` subtree matching the requested node
     (supporting `label/child` and `name@unit` segments).
   - `is_in_base`: whether the same identifier also resolves in the base DTS
     (`find_in_base` non-undefined) — replaces the `search_node_in_dts(base, …)` guard.

3. Port `resolve_node_identifier`'s `label/child` → absolute-path expansion using
   the new search (base first, then overlay).

Keep `parse_dts_node` / `parse_dts_value` / `parse_cell_array_element` in utilities
working — retarget them from `DtsNode`/`DtsValue`/`CellArrayElement` (legacy) to the
new `DTNode` / `DTValue[]|DTFlag` / `CellArrayElement` shapes (`dts/ast.ts`). Value
kinds differ: legacy `component.kind` of string/ref/bytes/array vs new DTValue
string/array/label/path and DTCellArray elements number/label/path/expression.

## Command porting (`attach-cli/src/commands/*/command.ts`)

Common pattern per mutating command (`add`, `delete`, `enable-disable`, `move`,
`rename`, `set-prop`, `unset-prop`):

- `parse_dts(contextText)` → `DeviceTree.new_from_string(contextText)`
  (returns `DeviceTree | string`; treat string as parse error).
- `parseDtso` + `mergeDtso(base, text, true)` →
  `DeviceTreeOverlay.new_from_string(overlayText, base_devicetree)`.
- `search_node_in_dts(merged, resolve_node_identifier(...))` → `find_in_overlay`.
- in-base guard `search_node_in_dts(base, …) !== undefined` → `is_in_base`.
- Mutate via the reference into the overlay DTO (direct node mutation) or via
  `DeviceTreeOverlay` helpers (`add_fragment`, etc.).
- `printDtso(merged)` → `overlay.print()`.
- Property construction: `create_cell_array` / `create_string_array` / `create_flag`
  → `PropertyBuilder` (DTBuilder). Note new `create_*` factories also exist in
  `dts/ast.ts` (lines 179–248) as drop-in equivalents returning `DTProperty` — may
  be simpler than `PropertyBuilder` for mechanical sites.

Per-command specifics:

- **get-prop**: `print_value(found.value)` → `print_property(prop, "\t", 0)` (or a
  trimmed single-value print); handle `DTFlag` (`is_dt_flag`) for boolean flags.
- **rename**: currently sets `name` + `unit_addr` directly. Use `rename_node` for
  the name and the new `set_unit_addr` for the unit (parse `name@unit` from `--to`).
- **move**: sibling collision via `get_full_node_name` (was `get_node_key`);
  `is_self_or_descendant` re-expressed over `DTNode.children`.
- **delete / unset-prop**: "in-overlay only" guard — since the overlay structure is
  itself the delta, a node/property found in `find_in_overlay` with
  `is_in_base === false` (node) or present in an `__overlay__` subtree (property) is
  overlay-owned. Replaces the `modified_by_user` check.
- **read-only commands** (`get-schema`, `suggest-parents`): these feed the parsed
  document into `query_devicetree` / `suggest_parents` / `Attach`, which still expect
  the legacy `DtsDocument`. **Deferred** this pass — keep them on `parse_dts` legacy
  until `DtQuery`/`Attach` are ported separately.

## Test strategy

Each ported command file has an `import.meta.vitest` block with helper-function
tests (`delete_overlay_node`, `rename_overlay_node`, `set_node_status`,
`move_overlay_node`, `unset_overlay_property`) plus `resolve_node_identifier` tests
in utilities. These currently build `mergeDtso(base, overlay, true)` and assert on
`printDtso` output substrings.

- Rewrite each vitest block to build `DeviceTree.new_from_string(base)` +
  `DeviceTreeOverlay.new_from_string(overlay, base)` and assert on `overlay.print()`.
- Preserve the existing test *intent* (same scenarios: deleted/in-base/not-found,
  rename conflict, move into-self, status overwrite, etc.).
- Output assertions must account for canonical fragment printing (`fragment@N`,
  `__overlay__`) vs legacy shorthand — assert on node/property names present, not
  exact block shape (matching how legacy tests already use `toContain`).

## Verification

From `packages/attach-lib/`:

- `yarn build` — new exports compile cleanly (verified).

From `packages/attach-cli/`:

- `yarn build` then `yarn test -- run` — all command + utilities vitest blocks pass.
- Manual smoke against `attach-cli/test.dtso` (uses `&spi0 { … }` shorthand): run
  `add`, `set-prop`, `enable`/`disable`, `rename`, `move`, `delete`, `unset-prop`,
  `get-prop` against a real base `.dts` (config `context`) and confirm the written
  `.dtso` re-parses and round-trips.
- Confirm `get-schema` / `suggest-parents` still work (kept on legacy parser).

## Suggested execution order (incremental, each independently testable)

1. `utilities.ts`: new search/resolve helpers + retarget `parse_dts_node` family.
2. `get-prop` (read-only, smallest).
3. `enable-disable`, `unset-prop`, `delete` (single-node mutations).
4. `rename`, `move` (name/unit + reparent).
5. `add` (fragment creation).
6. `get-schema` / `suggest-parents` — deferred (kept on legacy).
7. Full `yarn test -- run` + manual smoke.

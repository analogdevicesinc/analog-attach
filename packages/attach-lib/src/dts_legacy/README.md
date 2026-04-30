# DTS Library (src/AttachLib/dts)

This folder contains a small, self-contained TypeScript library for parsing,
merging, and printing Device Tree Source (DTS). It is designed to be UI-free,
fast to integrate, and predictable enough to round-trip real-world trees.

The library is split into five focused modules:

- ast.ts — Types used across the library (document, nodes, values, options).
- lexer.ts — Minimal lexical analyzer for DTS tokens.
- parser.ts — Concrete syntax parser that builds an AST and applies
  DTS overlay semantics and directives.
- merge.ts — Deterministic merge helpers for nodes/documents and utilities
  for lookup and deletion.
- printer.ts — Stable, configurable pretty printer to convert AST back to DTS.
- index.ts — Public API re-exports.

The sections below document each module and the conventions/semantics the
library implements.

## High-level Goals

- Parse a large subset of DTS (sufficient for Linux/Zephyr trees and overlays).
- Preserve enough information to print a stable round-trip representation.
- Provide explicit knobs to exactly match `dtc` compile→decompile output when
  required (node order, property order, phandles).
- Keep module boundaries small and pure for testing and reuse.

## Data Model (ast.ts)

The central types are:

- DtsDocument
  - versionTag: boolean — whether `/dts-v1/;` appeared.
  - memreserves: Array<{ address: bigint; length: bigint }> — `/memreserve/` entries.
  - root: DtsNode — the single root node `/`.

- DtsNode
  - labels?: string[] — node labels before the node (e.g., `soc: soc { ... }`).
  - name: string — node name, e.g. `soc`, `gpio`, `mmc`.
  - unitAddr?: string — the raw text after `@` (not parsed to bigint).
  - properties: DtsProperty[] — node properties.
  - children: DtsNode[] — child nodes.
  - order?: number — non-enumerable, internal “first-seen” ordering for stable printing/merge.

- DtsProperty
  - label?: string — optional single label immediately before the property.
  - name: string — property name.
  - value?: DtsValue — omitted for boolean/empty properties (e.g., `status;`).
  - order?: number — internal first-seen order.

- DtsValue
  - components: DtsValueComponent[] — comma-separated components in order.

- DtsValueComponent (discriminated union)
  - DtsString { kind: "string"; value: string; } — unquoted in AST.
  - DtsByteString { kind: "bytes"; bytes: Array<{ value: number; labelBefore?: string }>; } — `[ab cd ...]`.
  - DtsArray { kind: "array"; bitWidth?: 8|16|32|64; elements: ArrayElement[]; } — `</bits/ 32 < ... >>`.
  - DtsReference { kind: "ref"; ref: { kind: 'label' | 'path', ... } } — `&label` or `&{/path}`.
  - DtsInteger { kind: "int"; value: bigint; repr?: 'dec' | 'hex' | 'char'; } — scalars in property values.

- ArrayElement — wraps one item with an optional label, supporting:
  - number (bigint), 64-bit number (`u64` when `/bits/ 64`), or a reference.

- ParseOptions — currently a placeholder for future feature flags.

- PrintOptions
  - indent?: string — indentation string (default `\t`).
  - phandleMap?: Map<string, bigint> | Record<string, number|bigint> —
    optional mapping for explicit `phandle` injection. Keys may be the absolute
    path (`/soc/gpio@...`) or a `name[@unit]` key.
  - pathOrderMap?: Map<string, number> | Record<string, number> — optional
    absolute path → rank to override child order (useful to mirror `dtc`).
  - propertyOrderMap?: Map<string, Map<string, number>> | Record<string, Record<string, number>> —
    optional absolute path → property name → rank to override property order.

## Lexing (lexer.ts)

The Lexer produces a compact token stream understood by the parser:

- Identifiers: TokKind.Ident — dtc-friendly charset (letters, digits,
  punctuation like `.,_+-?#*`).
- Numbers: TokKind.Number — decimal (`123`) or hex (`0x1a2b`).
- Strings: TokKind.String — double-quoted, common escapes handled.
- Character literals: `'a'` lexed to TokKind.Number holding the code point.
- Punctuation: braces/parens/brackets/angles, `:`, `;`, `,`, `@`, `=`, `&`, `/`.
- Special `/bits/` token detected as TokKind.Bits.
- Comments: `// ...` and `/* ... */` skipped. Preprocessor line markers
  starting with `#` at column 0 are skipped as single lines.

The lexer is intentionally minimal — it doesn’t attempt full C preprocessor
support (`#include`), since higher layers can preprocess externally if needed.

## Parsing (parser.ts)

The Parser builds a DtsDocument from tokens and applies overlay and
directive semantics:

- Header & memreserve:
  - Recognizes optional `/dts-v1/;`, then any number of `/memreserve/ <addr> <len>;`.
- Nodes:
  - Root `/ { ... };` followed by more top-level blocks: either additional
    root bodies `/ { ... };` (merged) or overlays.
  - Non-root nodes use `name[@unit] { ... };` with optional labels before.
  - Interleaving properties and child nodes is allowed; order is preserved via
    an internal `order` sequence counter.
- Property values:
  - Strings (with escapes), bytes `[ ... ]`, arrays `< ... >` (with optional
    `/bits/ N`), references (`&label` or `&{/path}`), and scalar integers.
  - Constant expressions in arrays are supported with a minimal evaluator on
    `+ - * | << >>` (and parentheses). Unsupported tokens end the current
    array element.
- Overlays (`&label { ... }` and `&{/path} { ... }`):
  - The overlay body is parsed into a temporary node, then merged into the
    resolved target.
  - Label renames are tracked so references migrate (e.g. when a label changes
    across merged subtrees).
  - Delete directives (see below) inside overlays act on the resolved target
    subtree (not the overlay stub).
  - Path overlays (`&{/path}`) that target unknown nodes cause the parser to
    create missing nodes along the path (via `ensureNodeByPath`), assigning
    first‑seen order — this matches `dtc`’s behavior where “first touch wins”.
  - When an overlay appears earlier than a target’s first definition, the
    target’s `order` is pulled earlier so the final traversal order aligns
    with `dtc`.
- Directives in node bodies:
  - `/delete-property/ <name>;` — removes a property from the current node and
    from the target node in the accumulated document tree (relative to overlay
    target when inside overlays).
  - `/delete-node/ <key>;` — deletes a node by `name@unit[,unit]` relative to
    the overlay target when available, otherwise within the current node then
    document root. Forms with `&label` and `&{/path}` are also supported.

### Known Parser Trade-offs

- Constant expression support is intentionally limited (enough for common DTS);
  identifiers in expressions are not evaluated as macros or constants.
- Property scalar negatives (`foo = -1;`) are not parsed as a single integer
  value yet; negatives inside arrays are supported.
- Byte string character literals like `'a'` are lexed into a number token, and
  the byte string parser interprets number tokens as hex by spec; this makes
  `'a'` parse as `0x97` instead of `0x61`. Avoid char literals inside byte
  strings or preprocess them.
- Includes (`/include/`, `#include`) are not expanded by the parser. Use an
  external preprocessor if needed.

## Merge (merge.ts)

The merge helpers are used by the parser and can be reused externally:

- mergeNode(into, from) / mergeDocument(into, from) — recursively merge
  children and properties. The “incoming” (from) wins on property value.
- Order preservation — when a property or child already exists, the resulting
  order is the earliest of the two. Children and properties are stably sorted
  by order after merges.
- Label rename tracking — mergeNodeTrackRenames and mergeDocumentTrackRenames
  accept an onRename callback, letting the parser update references throughout
  the document.
- Deletion helpers — deleteNodeByKey and deleteNodeByLabel provide a simple
  recursive delete by key/label.
- Lookup helpers — findNodeByLabel, findNodeByPath traverse by label or
  absolute path. Internally node identity is `name[@unit]` (see nodeKey).

## Printing (printer.ts)

The printer aims to be deterministic under default settings and configurable
enough to exactly match `dtc`’s decompiled output when desired.

### Defaults

- Indentation is a single tab (`\t`), configurable via indent.
- Properties and children are printed in ascending order (first‑seen). Labels
  before/after value components are preserved.
- Arrays print decimal by default unless a component carried a `repr: 'hex'`.
- Negative numbers in arrays are printed inside parentheses per common DTS
  convention.

### Bytestrings

- Two hexadecimal digits per byte inside `[]`.
- Spaces between bytes are optional; `[00 01 02]` and `[000102]` are equivalent.
- Only hex digits are accepted; non-hex characters cause a parse error. Numeric
  tokens with an optional `0x` prefix are tolerated and normalized to hex pairs.

### Controlling Equality With dtc

The following PrintOptions can be supplied to make the printed DTS match
`dtc`’s decompiled form exactly:

- phandleMap — Inject a `phandle` property into nodes that don’t already have
  one, using the value from the map. This ensures phandle numbers match even if
  the traversal order would otherwise give different numbers.
- pathOrderMap — Override the order of children under each node using absolute
  path ranks. This reproduces `dtc`’s preorder traversal precisely.
- propertyOrderMap — Override the order of properties within each node to
  match `dtc`’s property emission.

Together, these options allow a compile→decompile of the original tree, then a
parse→print→compile→decompile of our output, and a byte‑for‑byte equality check.

## Public API (index.ts)

- export * from './ast' — types for consumers.
- export { parse_dts } from './parser' — parse DTS text into a DtsDocument.
- export { printDts } from './printer' — print a DtsDocument to DTS text.
- export { mergeDocument, mergeNode } from './merge' — explicit merge helpers.

## Examples

### Parse, modify, print

```ts
import { parse_dts, printDts, DtsDocument } from './AttachLib/dts';

const text = `/dts-v1/;\n/ { compatible = "board"; };\n`;
const doc: DtsDocument = parse_dts(text);

// Add a property
const root = doc.root;
root.properties.push({ name: 'model', value: { components: [{ kind: 'string', value: 'My Board' }] } });

const out = printDts(doc, { indent: '  ' });
console.log(out);
```

### Round-trip to match dtc

```ts
import { parse_dts, printDts } from './AttachLib/dts';

// 1) Compile + decompile the original DTS with dtc (external step)
// 2) Build phandleMap, pathOrderMap, propertyOrderMap from the decompiled text
// 3) Print with those maps to match dtc

const original = /* original DTS string */ '';
const doc = parse_dts(original);
const printed = printDts(doc, {
  phandleMap,         // absolutePath -> bigint phandle
  pathOrderMap,       // absolutePath -> preorder rank
  propertyOrderMap,   // absolutePath -> (prop -> rank)
});
```

## Testing

- Unit/integration tests live under src/test and exercise:
  - Minimal parsing, arrays/refs/bytes, labels.
  - Round-trip of real DTS fixtures (Raspberry Pi, Zephyr) with exact equality
    against dtc’s decompiled output using the printer options above.
- Overlay semantics: merging, label renames, property and node deletions.

## Limitations / TODOs

- Constant expression support is intentionally limited (no division, bitwise
  and/xor/complement, or named constants). Extend the evaluator if needed.
- Scalar negatives on property values (non‑array) are not parsed as a single
  integer yet.
- Byte strings: strictly two hexadecimal digits per byte inside `[]`. Spaces
  between bytes are optional, so both `[00 01 02]` and `[000102]` are valid.
  Only hex digits are accepted; other forms (e.g., character literals) are not
  interpreted as bytes in this context.
- Includes (`/include/`, `#include`) are not expanded; preprocess externally.
- Forward overlays by label to nodes not yet defined are not materialized as
  placeholders (overlays by absolute path are handled). If you encounter such
  trees and need exact dtc ordering, consider creating label placeholders or
  use the pathOrderMap printer option.

### Overlay Delete Semantics

- `/delete-node/` within an overlay applies strictly to the overlay target
  subtree; there is no fallback to the document root. This avoids unintended
  deletions of similarly named nodes elsewhere and matches overlay intent.

## Design Notes

- The library intentionally uses non‑enumerable order metadata on nodes and
  properties so it doesn’t interfere with structural comparisons or JSON
  serialization.
- merge.ts avoids circular dependencies by relying on a local nodeKey
  convention (`name[@unit]`). Keep this invariant consistent across modules.
- The expression evaluator uses new Function on sanitized token strings.
  Since it builds a restricted BigInt expression from already tokenized input,
  arbitrary code execution isn’t possible. Replace with a small Pratt parser if
  you need broader operator support.

If you have specific DTS constructs not covered here, file a test case in
src/test and we can extend the grammar or printer options accordingly.

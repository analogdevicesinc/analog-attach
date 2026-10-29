// The stand-in tree dt-validate checks for an overlay, built with attach-lib only. A copy of the CLI's
// `build_validation_dts` (packages/cli/src/backends/linux/commands/validate/command.ts), so the corpus validates the
// way `analog-attach validate` does: one `nodeN` per fragment holding the fragment's `__overlay__` children, plus a
// stub for every base-tree node the overlay references by label (interrupt parents, GPIO controllers, clock
// providers, …), carrying the provider's `#*-cells` and `*-controller` properties so dt-validate can decode
// specifiers such as `<&gpio 26 1>`. The merged tree can't be used instead: dt-validate crashes on it (`KeyError: '/'`
// in dtschema's `fixup_gpios`). Keep the two in step when the CLI's changes.

const TEMPLATE = `/dts-v1/;
/plugin/;

/ {
\tcompatible = "goo";
\tmodel = "goo";

\t#address-cells = <1>;
\t#size-cells = <1>;

\tnode{nr} {
\t\t// should be injected from parent
\t\t#address-cells = <{adr-c}>;
\t\t#size-cells = <{size-c}>;

\t};
};
`;

/** @param lib attach-lib's exports */
export function validation_tree(lib) {
  const { is_dt_flag, cell_extract_first_value, print_property } = lib;

  const node_key = (node) => (node.unit_addr === undefined ? node.name : `${node.name}@${node.unit_addr}`);
  const label_prefix = (node) => (node.labels.length > 0 ? `${node.labels.join(": ")}: ` : "");

  // Labels attached to `node` or any descendant.
  const defined_labels = (node) => [...node.labels, ...node.children.flatMap((child) => defined_labels(child))];

  // Labels referenced as phandles (`<&label …>`) by `node` or any descendant, in first-use order.
  function referenced_labels(node) {
    const labels = new Set();
    const scan = (n) => {
      for (const property of n.properties) {
        if (is_dt_flag(property.value)) continue;
        for (const cell of property.value) {
          if (cell.kind !== "array") continue;
          for (const element of cell.elements) if (element.kind === "label") labels.add(element.name);
        }
      }
      for (const child of n.children) scan(child);
    };
    scan(node);
    return [...labels];
  }

  function print_dtprop(property, indent) {
    if (is_dt_flag(property.value)) return `${indent}${property.name};`;
    return `${indent}${print_property(property, indent, 0).trim()}`;
  }

  function print_dtnode(node, indent) {
    return [
      `${indent}${label_prefix(node)}${node_key(node)} {`,
      ...node.properties.map((property) => print_dtprop(property, indent + "\t")),
      ...node.children.map((child) => print_dtnode(child, indent + "\t")),
      `${indent}};`,
    ].join("\n");
  }

  // A base-tree provider reduced to what specifier decoding needs: its labels, `#*-cells` and `*-controller` flags.
  function print_provider_stub(provider, indent) {
    const properties = provider.properties.filter((p) => /^#.+-cells$/.test(p.name) || p.name.endsWith("-controller"));
    return [`${indent}${label_prefix(provider)}${node_key(provider)} {`, ...properties.map((property) => print_dtprop(property, indent + "\t")), `${indent}};`].join("\n");
  }

  function fragment_target_node(fragment, base) {
    const target = fragment.properties.find((p) => p.name === "target");
    if (target !== undefined && !is_dt_flag(target.value)) {
      const first = target.value[0];
      if (first?.kind === "array") {
        for (const element of first.elements) {
          if (element.kind === "label" || element.kind === "path") {
            const located = base.locate(element);
            if (located !== undefined) return located.node;
          }
        }
      }
    }
    const target_path = fragment.properties.find((p) => p.name === "target-path");
    if (target_path !== undefined && !is_dt_flag(target_path.value)) {
      const first = target_path.value[0];
      if (first?.kind === "string") return base.node_at(first.value);
    }
    return undefined;
  }

  function cell_value(node, name) {
    const property = node.properties.find((p) => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) return undefined;
    const value = cell_extract_first_value(property);
    return typeof value === "bigint" ? value : undefined;
  }

  function interrupt_info(node) {
    let has_interrupts = false;
    let interrupt_parent_label;
    const scan = (n) => {
      for (const property of n.properties) {
        if (property.name === "interrupts") has_interrupts = true;
        if (property.name === "interrupt-parent" && !is_dt_flag(property.value)) {
          const first = property.value[0];
          if (first?.kind === "array") {
            for (const element of first.elements) if (element.kind === "label") interrupt_parent_label = element.name;
          }
        }
      }
      for (const child of n.children) scan(child);
    };
    scan(node);
    return { has_interrupts, interrupt_parent_label };
  }

  /** The stand-in tree for a parsed DeviceTreeOverlay, as dts text. */
  return function build_validation_dts(overlay) {
    const base = overlay.get_base_dts();
    const fragments = overlay.get_fragments();
    const roots = fragments.flatMap((fragment) => fragment.children.filter((c) => c.name === "__overlay__"));
    // Labels the overlay defines itself need no stub (and must not be defined twice).
    const defined = new Set(roots.flatMap((root) => defined_labels(root)));
    const stubbed = new Set();
    const blocks = [];

    for (const [index, fragment] of fragments.entries()) {
      const target = base === undefined ? undefined : fragment_target_node(fragment, base);
      const address_cells = target === undefined ? 1n : (cell_value(target, "#address-cells") ?? 1n);
      const size_cells = target === undefined ? 0n : (cell_value(target, "#size-cells") ?? 0n);
      const overlay_child = fragment.children.find((c) => c.name === "__overlay__");
      const lines = [];

      if (overlay_child !== undefined) {
        const info = interrupt_info(overlay_child);
        if (info.has_interrupts && info.interrupt_parent_label === undefined) {
          const fake = `fake_intc_${index}`;
          lines.push(`\t\tinterrupt-parent = <&${fake}>;`, `\t\t${fake}: ${fake} {`, `\t\t\t#interrupt-cells = <1>;`, `\t\t\tinterrupt-controller;`, `\t\t};`);
        }
        for (const label of referenced_labels(overlay_child)) {
          if (defined.has(label) || base === undefined) continue;
          const provider = base.locate(label)?.node;
          if (provider === undefined || stubbed.has(provider)) continue;
          stubbed.add(provider);
          lines.push(print_provider_stub(provider, "\t\t"));
        }
        for (const child of overlay_child.children) lines.push(print_dtnode(child, "\t\t"));
      }

      const content = lines.length > 0 ? "\n" + lines.join("\n") + "\n" : "";
      blocks.push(`\tnode${index} {\n\t\t#address-cells = <${address_cells}>;\n\t\t#size-cells = <${size_cells}>;${content}\t};`);
    }

    return TEMPLATE.replace(/[ \t]*node\{nr\} \{[\s\S]*?\n[ \t]*\};/, blocks.join("\n\n"));
  };
}

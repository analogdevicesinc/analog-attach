import { INTERRUPT_MACROS, GPIO_MACROS } from "../DtQuery.js";

const ALL_MACROS = [...INTERRUPT_MACROS, ...GPIO_MACROS];

import type {
  DtsCellArray,
  DtsByteArray,
  DtsDocument,
  DtsNode,
  DtsProperty,
  DtsReference,
  DtsValue,
  DtsValueComponent,
} from "./ast";

import { stringify as stringify_as_yaml } from "yaml";
import { DtsMetadataHeader } from "./constants.js";

/**
 * Print a DtsDocument back to DTS text.
 *
 * By default, printing preserves first-seen order of properties and children,
 * adds `/dts-v1/;` and `/memreserve/` as encountered
 */
export function print_dts(document: DtsDocument): string {
  const indent = "\t";
  const out: string[] = [];

  out.push("/dts-v1/;\n");

  for (const mr of document.memreserves) {
    out.push(`/memreserve/ ${fmt_big_hex(mr.address)} ${fmt_big_hex(mr.length)};\n`);
  }

  out.push(print_node(document.root, indent, 0, '/'));

  if (document.metadata !== undefined) {
	out.push(`
/*
---
${DtsMetadataHeader}${stringify_as_yaml(document.metadata)}
...
*/
`);
  }

  return out.join("");
}

/** Print a single node and its subtree. */
function print_node(
  node: DtsNode,
  indent: string,
  depth: number,
  absPath: string
): string {
  const pad = indent.repeat(depth);

  const name = node.unit_addr === undefined ? node.name : `${node.name}@${node.unit_addr}`;

  const currentPath = node.name === '/' ? '/' : `${absPath}${absPath.endsWith('/') ? '' : '/'}${name}`;
  const labels = node.labels.map((label) => `${label}: `).join("");

  let out = `${pad}${labels}${name} {\n`;

  const properties: DtsProperty[] = structuredClone(node.properties);

  for (const property of properties) {
    if (property.deleted !== true) {
      out += print_property(property, indent, depth + 1);
    }
  }

  const baseChildren = structuredClone(node.children);

  for (const child of baseChildren) {
    if (child.deleted !== true) {
      out += print_node(child, indent, depth + 1, currentPath);
    }
  }

  out += `${pad}};\n`;

  return out;
}

/** Print a single property, including its value if present. */
export function print_property(property: DtsProperty, indent: string, depth: number): string {
  const pad = indent.repeat(depth);

  let labels: string = "";
  for (const label of property.labels) {
    labels = labels + `${label}: `;
  }

  if (property.value === undefined) {
    return `${pad}${labels}${property.name};\n`;
  }

  const v = print_value(property.value);

  return `${pad}${labels}${property.name} = ${v};\n`;
}

/** Print a property value comprised of comma-separated components. */
function print_value(v: DtsValue): string {
  const parts: string[] = [];

  for (const c of v.components) {
    parts.push(print_component(c));
  }

  return parts.join(", ");
}

/** Print a single value component with optional before/after labels. */
function print_component(component: DtsValueComponent): string {

  let labels: string = "";
  for (const label of component.labels) {
    labels = labels + `${label}: `;
  }

  switch (component.kind) {
    case "string":
      {
        return `${labels}"${component.value}"`;
      }
    case "bytes":
      {
        return `${labels}${print_bytes(component)}`;
      }
    case "array":
      {
        return `${labels}${print_array(component)}`;
      }
    case "ref":
      {
        return `${labels}${print_references(component)}`;
      }
    default:
      {
        const _x: never = component;
        throw new Error("Failed exhaustive switch!");
      }
  }
}

/** Print a byte string as `[aa bb ...]` with preserved byte labels. */
function print_bytes(b: DtsByteArray): string {
  const parts: string[] = [];

  for (const byte of b.bytes) {
    let labels: string = "";

    for (const label of byte.labels) {
      labels = labels + `${label}: `;
    }

    parts.push(`${labels}${to_hex_2(byte.value)}`);
  }

  return `[${parts.join(" ")}]`;
}

/** Print an array, honoring `/bits/` and item representation hints. */
function print_array(a: DtsCellArray): string {
  const parts: string[] = [];

  for (const element of a.elements) {
    let labels: string = "";

    for (const label of element.item.labels) {
      labels = labels + `${label}: `;
    }

    switch (element.item.kind) {
      case "ref":
        {
          parts.push(`${labels}${print_references(element.item)}`);
          break;
        }
      case "u64":
        {
          parts.push(`${labels}${print_array_number(element.item.value, element.item.repr)}`);
          break;
        }
      case "number":
        {
          parts.push(`${labels}${print_array_number(element.item.value, element.item.repr)}`);
          break;
        }
      case "expression":
        {
          parts.push(`${labels}${element.item.value}`);
          break;
        }
      case "macro":
        {
          const item = element.item.value;
          const is_macro = ALL_MACROS.find((macro) => macro.name === item);

          if (is_macro === undefined) {
            throw new Error("Used unknown macro");
          } else {
            parts.push(`${labels}${is_macro.value}`);
          }

          break;
        }
      default:
        {
          const _x: never = element.item;
          throw new Error("Failed exhaustive switch check!");
        }
    }
  }

  const bw = a.bit_width ? `/bits/ ${a.bit_width} ` : "";

  return `${bw}<${parts.join(" ")}>`;
}

/** Print a reference as `&label` or `&{/path}`. */
function print_references(r: DtsReference): string {
  if (r.ref.kind === "label") {
    const name = r.ref.name;
    return name.startsWith("&") ? name : `&${name}`;
  }

  const path = r.ref.path;
  return path.startsWith("&") ? path : `&{${path}}`;
}

/** Print a BigInt as hexadecimal (with `0x`, handling negative). */
function fmt_big_hex(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return `${sign}0x${abs.toString(16)}`;
}

/** Two-digit hexadecimal for a byte. */
function to_hex_2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** Decimal BigInt as string. */
function fmt_big_dec(n: bigint): string {
  return n.toString(10);
}

/** Print a numeric array element using its preferred representation. */
function print_array_number(n: bigint, repr?: 'dec' | 'hex'): string {
  if (repr === 'hex') {
    return fmt_big_hex(n);
  }

  // default decimal; DTS often uses parentheses for negative elements inside arrays
  if (n < 0n) {
    return `(${fmt_big_dec(n)})`;
  }

  return fmt_big_dec(n);
}

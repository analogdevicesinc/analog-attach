import type {
  DTCellArray,
  DTNode,
  DTProperty,
  DTValue,
  DTS,
  DTLabel,
  DTPath,
  DTO,
  DTMetadata,
} from "./ast";
import { Bits, is_dt_flag } from "./ast.js";

import { stringify as stringify_as_yaml } from "yaml";
import { DTS_METADATA_HEADER } from "./parser";

import { assert_never } from "../utilities.js";

/**
 * Print a DtsDocument back to DTS text.
 *
 * By default, printing preserves first-seen order of properties and children,
 * adds `/dts-v1/;` and `/memreserve/` as encountered
 */
export function print_dts(document: DTS, metadata?: DTMetadata): string {
  const indent = "\t";
  const out: string[] = [];

  out.push("/dts-v1/;\n");

  for (const mr of document.memreserves) {
    out.push(`/memreserve/ ${fmt_big_hex(mr.address)} ${fmt_big_hex(mr.length)};\n`);
  }

  out.push(print_node(document.root, indent, 0, '/'));

  if (metadata !== undefined) {
    const serialized_metadata = serialize_metadata(metadata);
    out.push(serialized_metadata);
  }

  return out.join("");
}

export function print_dto(document: DTO, metadata?: DTMetadata): string {
  const indent = "\t";
  const out: string[] = [];

  out.push("/dts-v1/;\n", "/plugin/;\n", print_node(document.root, indent, 0, '/'));

  if (metadata !== undefined) {
    const serialized_metadata = serialize_metadata(metadata);
    out.push(serialized_metadata);
  }

  return out.join("");
}

function serialize_metadata(metadata: DTMetadata): string {
  return `/*\n${DTS_METADATA_HEADER}\n---\n${stringify_as_yaml(metadata)}\n...\n*/`;
}

/** Print a single node and its subtree. */
function print_node(
  node: DTNode,
  indent: string,
  depth: number,
  absPath: string
): string {
  const pad = indent.repeat(depth);

  const name = node.unit_addr === undefined ? node.name : `${node.name}@${node.unit_addr}`;

  const currentPath = node.name === '/' ? '/' : `${absPath}${absPath.endsWith('/') ? '' : '/'}${name}`;
  const labels = node.labels.map((label) => `${label}: `).join("");

  let out = `${pad}${labels}${name} {\n`;

  const properties: DTProperty[] = structuredClone(node.properties);

  for (const property of properties) {
    out += print_property(property, indent, depth + 1);
  }

  const baseChildren = structuredClone(node.children);

  for (const child of baseChildren) {
    out += print_node(child, indent, depth + 1, currentPath);
  }

  out += `${pad}};\n`;

  return out;
}

/** Print a single property, including its value if present. */
export function print_property(property: DTProperty, indent: string, depth: number): string {
  const pad = indent.repeat(depth);

  let labels: string = "";
  for (const label of property.labels) {
    labels = labels + `${label}: `;
  }

  if (is_dt_flag(property.value)) {
    return `${pad}${labels}${property.name};\n`;
  }

  const v = print_value(property.value);

  return `${pad}${labels}${property.name} = ${v};\n`;
}

/** Print a property value comprised of comma-separated components. */
export function print_value(v: DTValue[]): string {
  const parts: string[] = [];

  for (const c of v) {
    parts.push(print_component(c));
  }

  return parts.join(", ");
}

/** Print a single value component with optional before/after labels. */
function print_component(component: DTValue): string {

  let labels: string = "";
  for (const label of component.labels) {
    labels = labels + `${label}: `;
  }

  switch (component.kind) {
    case "string":
      {
        return `${labels}"${component.value}"`;
      }
    case "array":
      {
        return `${labels}${print_array(component)}`;
      }
    case "label":
    case "path":
      {
        return `${labels}${print_references(component)}`;
      }
    default:
      {
        assert_never(component);
      }
  }
}

/** Print an array, honoring `/bits/` and item representation hints. */
function print_array(a: DTCellArray): string {
  const parts: string[] = [];

  for (const element of a.elements) {
    let labels: string = "";

    for (const label of element.labels) {
      labels = labels + `${label}: `;
    }

    switch (element.kind) {
      case "label": case "path":
        {
          parts.push(`${labels}${print_references(element)}`);
          break;
        }
      case "number":
        {
          parts.push(`${labels}${print_array_number(element.value, element.repr)}`);
          break;
        }
      case "expression":
        {
          parts.push(`${labels}${element.value}`);
          break;
        }
      default:
        {
          const _x: never = element;
          throw new Error("Failed exhaustive switch check!");
        }
    }
  }

  const bw = a.bit_width === Bits.b32 ? "" : `/bits/ ${a.bit_width} `;

  return `${bw}<${parts.join(" ")}>`;
}

/** Print a reference as `&label` or `&{/path}`. */
function print_references(r: DTLabel | DTPath): string {
  switch (r.kind) {
    case "label":
      {
        return `&${r.name}`;
      }
    case "path":
      {
        return `\${${r.path}}`;
      }
    default:
      {
        assert_never(r);
      }
  }
}

/** Print a BigInt as hexadecimal (with `0x`, handling negative). */
function fmt_big_hex(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return `${sign}0x${abs.toString(16)}`;
}

/** Two-digit hexadecimal for a byte. */
function to_hex_2(n: bigint): string {
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

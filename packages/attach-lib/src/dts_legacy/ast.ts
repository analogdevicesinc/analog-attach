import { UUID } from "node:crypto";

/** Width specifier used by `/bits/` arrays. */
export type Bits = 8 | 16 | 32 | 64;

export type Memreserve = {
  address: bigint,
  length: bigint,
};

export type UnresolvedOverlay = {
  overlay_target_ref: DtsReference,
  overlay_node: DtsNode,
};

export type DtsDocument = {
  memreserves: Array<Memreserve>;
  root: DtsNode;
  /** Unresolved overlay fragments (for DTSO files with label references) */
  unresolved_overlays: Array<UnresolvedOverlay>;
  metadata: DtsMetadata | undefined;
}

/** Node within the DTS tree (`name[@unit]`). */
export type DtsNode = {
  labels: string[];
  name: string;
  /** @field _uuid Internal. */
  _uuid: UUID;
  /** Raw text after `@` (unit address), preserved as-is. */
  unit_addr?: string;
  properties: DtsProperty[];
  children: DtsNode[];
  deleted: boolean,
  modified_by_user?: boolean;
  created_by_user?: boolean;
}

/** Property inside a node. */
export type DtsProperty = {
  labels: string[];
  name: string;
  /** Missing `value` indicates a boolean/empty property (e.g., `status;`). */
  value?: DtsValue;
  deleted: boolean,
  modified_by_user?: boolean;
}

/** Value assigned to a property (possibly comma-separated). */
export type DtsValue = {
  components: DtsValueComponent[];
}

export type DtsValueComponent =
  | DtsString
  | DtsByteArray
  | DtsCellArray
  | DtsReference;

export type Labeled = {
  labels: string[];
}

export type DtsString = Labeled & {
  kind: "string";
  /** Raw value without the surrounding quotes. */
  value: string;
}

/** Byte string value, e.g. `[ab cd 00]`. */
export type DtsByteArray = Labeled & {
  kind: "bytes";
  // Each byte is 0..255; labels may annotate specific bytes. 
  bytes: Array<{ value: number; labels: string[] }>;
}

/** Numeric/reference array value, optionally preceded by `/bits/ N`. */
export type DtsCellArray = Labeled & {
  kind: "array";
  bit_width?: Bits;
  elements: Array<CellArrayElement>;
}

export type CellArrayElement = {
  item: CellArrayNumber | CellArrayU64 | DtsReference | ConstExpression | Macro
};

/** Numeric (<= 32-bit) array element. */
export type CellArrayNumber = Labeled & {
  kind: "number";
  /** Numeric value stored as bigint; must fit in `bitWidth`. */
  value: bigint;
  /** Original representation hint for printing. */
  repr?: "dec" | "hex";
}

// TODO: not sure this is how it's supposed to be; my suspicion is that they are still 2 32bit for a 64 one but it'll be interpreted as a 64bit 
/** 64-bit array element when `/bits/ 64` is active. */
export type CellArrayU64 = Labeled & {
  kind: "u64";
  value: bigint;
  repr?: "dec" | "hex";
}

export type ConstExpression = Labeled & {
  kind: "expression",
  value: string
}

export type Macro = Labeled & {
  kind: "macro",
  value: string,
}

/** Reference to a label (e.g., `&gpio`) or an absolute path `&{/path}`. */
export type DtsReference = Labeled & {
  kind: "ref";
  ref:
  { kind: "label"; name: string } |
  { kind: "path"; path: string };
}

export function create_flag(name: string, labels?: string[]): DtsProperty {
  return {
    labels: labels ?? [],
    name: name,
    deleted: false,
    modified_by_user: true
  };
}

export function create_string_array(name: string, value: string | string[], labels?: string[]): DtsProperty {

  const normalized_value = Array.isArray(value) ? value : [value];

  return {
    labels: labels ?? [],
    name: name,
    deleted: false,
    modified_by_user: true,
    value: {
      components: normalized_value.map((entry) => {
        return {
          kind: "string",
          value: entry,
          labels: []
        };
      })
    }
  };
}

export type CellArrayString = {
  value: string,
  type: "PHANDLE" | "PATH_REFERENCE" | "MACRO" | "EXPRESSION"
}

export function create_cell_array(
  name: string,
  value: bigint | CellArrayString | (bigint | CellArrayString)[],
  labels?: string[]): DtsProperty {

  if (!Array.isArray(value)) {
    return {
      labels: labels ?? [],
      name: name,
      deleted: false,
      modified_by_user: true,
      value: {
        components: [
          {
            kind: "array",
            labels: [],
            elements: [create_cell_value(value)]
          }
        ]
      }
    };
  }

  return {
    labels: labels ?? [],
    name: name,
    deleted: false,
    modified_by_user: true,
    value: {
      components: [
        {
          kind: "array",
          labels: [],
          elements: value.map((entry) => create_cell_value(entry))
        }
      ]
    }
  };
}

function create_cell_value(value: bigint | CellArrayString): CellArrayElement {
  if (typeof value === 'bigint') {
    return {
      item: {
        kind: "number",
        value: value,
        labels: []
      },
    };
  }

  const string_type = value.type;
  switch (string_type) {
    case "MACRO": {
      return {
        item: {
          kind: "macro",
          value: value.value,
          labels: []
        },
      };
    }
    case "PHANDLE": {
      return {
        item: {
          kind: "ref",
          ref: {
            kind: "label",
            name: value.value,
          },
          labels: []
        },
      };
    }
    case "PATH_REFERENCE": {
      return {
        item: {
          kind: "ref",
          ref: {
            kind: "path",
            path: value.value,
          },
          labels: []
        },
      };
    }
    case "EXPRESSION": {
      return {
        item: {
          kind: "expression",
          value: value.value,
          labels: []
        },
      };
    }
    default: {
      const _x: never = string_type;
      throw new Error("Exhaustive check failed!");
    }
  }
}

export type Version = string;

export function isVersion(object: any): object is Version {
  if (typeof object !== "string") {
    return false;
  }

  const version_regex = /^\d+\.\d+\.\d+$/;
  if (!version_regex.test(object)) {
    return false;
  }

  return true;
}

export type AbsolutePathToDTSNode = string;

export function isAbsolutePathToDTSNode(object: any): object is AbsolutePathToDTSNode {
  return typeof object === "string";
}

export function isArrayOfAbsolutePathToDTSNode(object: any): object is AbsolutePathToDTSNode[] {
  return Array.isArray(object)
    && object.every(element => isAbsolutePathToDTSNode(element));
}

export type DtsMetadata = {
  version: Version;
  modified: AbsolutePathToDTSNode[];
};

export function isDtsMetadata(object: any): object is DtsMetadata {
  if (typeof object !== 'object' || object === null) {
    return false;
  }

  if (Object.keys(object).length !== 2) {
    return false;
  }

  if (!("version" in object) || !("modified" in object)) {
    return false;
  }

  if (!isVersion(object.version)) {
    return false;
  }

  if (!isArrayOfAbsolutePathToDTSNode(object.modified)) {
    return false;
  }

  return true;
}
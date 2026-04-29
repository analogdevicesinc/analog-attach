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
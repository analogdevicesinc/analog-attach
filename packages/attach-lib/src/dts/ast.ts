// TODO: ok for now, unify with WIP Devicetree branch
export type Labeled = {
  labels: string[];
}

/** Width specifier used by `/bits/` arrays. */
export enum Bits {
  b8 = 8,
  b16 = 16,
  b32 = 32,
  b64 = 64
}

export function is_bits(value: any): value is Bits {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "number") {
    return false;
  }

  return Object.values(Bits).filter(v => typeof v === "number").includes(value);
}

export type Memreserve = {
  address: bigint,
  length: bigint,
};

export type DTS<T extends DTNode = DTNode<DTProperty>> = {
  memreserves: Memreserve[];
  root: T;
}

export type DTO<T extends DTNode = DTNode<DTProperty>> = {
  root: T;
}

export interface DTNode<T extends DTProperty = DTProperty> extends Labeled {
  name: string;
  unit_addr: string | undefined;
  properties: T[];
  children: this[];
}

export function get_full_node_name(node: DTNode): string {
  return `${node.name}${node.unit_addr === undefined ? "" : `@${node.unit_addr}`}`;
}

export type DTProperty = Labeled & {
  name: string;
  value: DTValue[] | DTFlag;
}

export type DTFlag = {
  kind: "flag"
};

export function is_dt_flag(object: any): object is DTFlag {

  if (!("kind" in object)) {
    return false;
  }

  if (Object.entries(object).length > 1) {
    return false;
  }

  const narrowed = object as DTFlag;

  if (narrowed.kind !== 'flag') {
    return false;
  }

  return true;
}

export type DTValue =
  | DTString
  | DTCellArray
  | DTLabel
  | DTPath

export type DTString = Labeled & {
  kind: "string";
  value: string;
}

export type DTCellArray = Labeled & {
  kind: "array";
  bit_width: Bits;
  elements: CellArrayElement[];
}

export type CellArrayElement =
  | DTNumber
  | DTLabel
  | DTPath
  | DTExpression

export type DTNumber = Labeled & {
  kind: "number";
  value: bigint;
  repr: "dec" | "hex";
}

export type DTExpression = Labeled & {
  kind: "expression",
  value: string
}

export type DTLabel = Labeled & {
  kind: "label";
  name: string
}

export type DTPath = Labeled & {
  kind: "path";
  path: string
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

export type DTPathToPropertyOrNode = string;

export function isDTPathToNodeOrProperty(object: any): object is DTPathToPropertyOrNode {
  return typeof object === "string";
}

export function isArrayOfDTPathToNodeOrProperty(object: any): object is DTPathToPropertyOrNode[] {
  return Array.isArray(object) && object.every(element => typeof element === "string");
}

export type DTMetadata = {
  version: Version;
  modifications: DTPathToPropertyOrNode[];
}

export function isDTMetadata(object: any): object is DTMetadata {
  if (typeof object !== 'object' || object === null) {
    return false;
  }

  if (Object.keys(object).length !== 2) {
    return false;
  }

  if (!("version" in object) || !("modifications" in object)) {
    return false;
  }

  if (!isVersion(object.version)) {
    return false;
  }

  if (!isArrayOfDTPathToNodeOrProperty(object.modifications)) {
    return false;
  }

  return true;
}
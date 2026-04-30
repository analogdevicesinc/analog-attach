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

export type Memreserve = {
  address: bigint,
  length: bigint,
};

export type DTS<T extends DTNode = DTNode<DTProperty>> = {
  memreserves: Array<Memreserve>;
  root: T;
}

export type DTO<T extends DTNode = DTNode<DTProperty>> = {
  root: T;
}

/** Node within the DTS tree (`name[@unit]`). */
export interface DTNode<T extends DTProperty = DTProperty> extends Labeled {
  name: string;
  /** Raw text after `@` (unit address), preserved as-is. */
  unit_addr: string | undefined;
  properties: T[];
  children: this[];
}

/** Property inside a node. */
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
  | DTByteArray
  | DTCellArray
  | DTLabel
  | DTPath

export type DTString = Labeled & {
  kind: "string";
  value: string;
}

export type DTByteArray = Labeled & {
  kind: "bytes";
  // Each byte is 0..255; labels may annotate specific bytes. 
  // TODO: think of better solution
  bytes: Array<Labeled & { byte: number }>;
}

export type DTCellArray = Labeled & {
  kind: "array";
  bit_width: Bits;
  elements: Array<CellArrayElement>;
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
};


export function create_flag(name: string, labels?: string[]): DTProperty {
  return {
    labels: labels ?? [],
    name: name,
    value: {
      kind: "flag"
    }
  };
}

export function create_string_array(name: string, value: string | string[], labels?: string[]): DTProperty {

  const normalized_value = Array.isArray(value) ? value : [value];

  return {
    labels: labels ?? [],
    name: name,
    value:
      normalized_value.map((entry) => {
        return {
          kind: "string",
          value: entry,
          labels: []
        };
      })

  };
}

// TODO: obsolete when DTBuilder is integrated

export type CellArrayString = {
  value: string,
  type: "PHANDLE" | "PATH_REFERENCE" | "EXPRESSION"
}

export function create_cell_array(
  name: string,
  value: bigint | CellArrayString | (bigint | CellArrayString)[],
  labels?: string[]): DTProperty {

  if (!Array.isArray(value)) {
    return {
      labels: labels ?? [],
      name: name,
      value:
        [
          {
            kind: "array",
            labels: [],
            bit_width: Bits.b32,
            elements: [create_cell_value(value)]
          }
        ]

    };
  }

  return {
    labels: labels ?? [],
    name: name,
    value:
      [
        {
          kind: "array",
          labels: [],
          bit_width: Bits.b32,
          elements: value.map((entry) => create_cell_value(entry))
        }
      ]
  };
}

function create_cell_value(value: bigint | CellArrayString): CellArrayElement {
  if (typeof value === 'bigint') {
    return {
      kind: "number",
      value: value,
      repr: "dec",
      labels: []
    };
  }

  const string_type = value.type;
  switch (string_type) {
    case "PHANDLE": {
      return {
        kind: "label",
        name: value.value,
        labels: []
      };
    }
    case "PATH_REFERENCE": {
      return {
        kind: "path",
        path: value.value,
        labels: []
      };
    }
    case "EXPRESSION": {
      return {
        kind: "expression",
        value: value.value,
        labels: []
      };
    }
    default: {
      const _x: never = string_type;
      throw new Error("Exhaustive check failed!");
    }
  }
}
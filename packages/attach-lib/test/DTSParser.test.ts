import path from 'node:path';
import * as fs from 'node:fs';

import { test, expect, describe } from 'vitest';
import { Result } from '../src/result';

import type { DTSParseResult, DTLabel, DTO, DTS } from "../src/Devicetree/Parser/index.js";
import { parse_dto, parse_dts, print_dts, Bits, is_dt_flag, isDTMetadata } from "../src/Devicetree/Parser/index.js";

import { stringify as stringify_as_yaml } from "yaml";

const TEST_DTS_FILES_DIR_PATH = path.resolve(__dirname, "dts_source/");

describe("round trip", () => {
  test('minimal', () => {
    basic_round_trip_test_impl("minimal.dts");
  });

  test("types", () => {
    basic_round_trip_test_impl("basic_types.dts");
  });

  test("preprocessed", () => {
    basic_round_trip_test_impl("rpi.prepro.dts");
  });

  test("zephyr", () => {
    basic_round_trip_test_impl("zephyr.dts");
  });

  test("metadata", () => {
    basic_round_trip_test_impl("comments.dts");
  });
});

describe("types", () => {
  test('bytestring supports compact hex with spaces', () => {
    const { dts } = parse_dts_from_file("basic_types.dts");

    const bytes_property = dts.root.properties.find(p => p.name === 'bytes');
    expect.assert.isDefined(bytes_property);

    if (is_dt_flag(bytes_property.value)) {
      expect.fail("value of 'bytes' property should not be empty");
    }

    const component = bytes_property.value[0];
    if (component.kind !== "array" || component.bit_width !== Bits.b8) {
      expect.fail("value of 'bytes' property must be an array and its bit width must be equal to 8");
    }

    if (!component.elements.every(dtv => dtv.kind === "number")) {
      expect.fail("all values within 'bytes' property must be numbers");
    }

    expect(component.elements.map(dtv => Number.parseInt(dtv.value.toString())))
      .toStrictEqual([0x00, 0x00, 0x00, 0x1B, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x00]);
  });

  test("bytestring supports compact hex without spaces", () => {
    const { dts } = parse_dts_from_file("basic_types.dts");

    const bytes_property = dts.root.properties.find(p => p.name === 'bytes2');
    expect.assert.isDefined(bytes_property);

    if (is_dt_flag(bytes_property.value)) {
      expect.fail("value of 'bytes2' property should not be empty");
    }

    const component = bytes_property.value[0];
    if (component.kind !== "array" || component.bit_width !== Bits.b8) {
      expect.fail("value of 'bytes2' property must be an array and its bit width must be equal to 8");
    }

    if (!component.elements.every(dtv => dtv.kind === "number")) {
      expect.fail("all values within 'bytes' property must be numbers");
    }

    expect(component.elements.map(dtv => Number.parseInt(dtv.value.toString())))
      .toStrictEqual([0x00, 0x00, 0x00, 0x1B, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x00]);
  });
});

describe("merging behavior", () => {
  test("later root overrides earlier", () => {
    const { dts: dts1 } = parse_dts_from_file("merge_input.dts");
    const child_node = dts1.root.children.find(c => c.name === 'node' && (c.labels ?? []).includes('a'));

    expect.assert.isDefined(child_node);

    const property = child_node.properties.find(p => p.name === 'x');
    expect.assert.isDefined(property);

    const { dts: dts2 } = parse_dts_from_file("merge_output.dts");
    expect(normalize(dts1))
      .toStrictEqual(normalize(dts2));
  });
});

describe("delete behavior", () => {
  test("/delete-property/ removes alias intc", () => {
    const { dts } = parse_dts_from_file("delete_merge_alias.dts");
    const aliases = dts.root.children.find(c => c.name === 'aliases');

    expect.assert.isDefined(aliases);

    expect(aliases.properties.length).toStrictEqual(3);

    for (const property of aliases.properties) {
      if (!['soc', 'uart2', 'spi'].includes(property.name)) {
        expect.fail(`Extra alias after merge: ${property.name}`);
      }

      if (property.name === 'intc') {
        expect.fail('aliases still contains intc');
      }

      if (property.name === "spi") {
        if (is_dt_flag(property.value)) {
          expect.fail("spi should not be an empty property");
        }

        const expected: DTLabel = { labels: [], kind: "label", name: "spi2" };
        expect(property.value.length).toStrictEqual(1);
        expect(property.value[0]).toStrictEqual(expected);
      }
    }
  });

  test("delete from overlay is relative and does not remove same-named root node", () => {
    const { dts } = parse_dts_from_file("relative_delete_node_with_overlay.dts");

    const leds = dts.root.children.find(c => c.name === "leds");
    expect.assert.isDefined(leds);
    expect(leds.labels.includes("leds"), "Missing label on leds node");
  });

  test("delete node from overlay successful delete", () => {
    const { dts } = parse_dts_from_file("delete_node_with_overlay.dts");

    const leds = dts.root.children.find(c => c.name === "leds");
    expect.assert.isDefined(leds, "Missing leds node");

    const foo = leds.children.find(c => c.name === "foo");
    expect.assert.isUndefined(foo, "This node should have been deleted");
  });

  test("delete property from overlay successful delete", () => {
    const { dts } = parse_dts_from_file("delete_property_with_overlay.dts");

    const leds = dts.root.children.find(c => c.name === "leds");
    expect.assert.isDefined(leds, "Missing leds node");

    const property = leds.properties.find((c) => c.name === "property");
    expect.assert.isUndefined(property, "This property should have been deleted");
  });
});

describe("labeling", () => {
  test("basic", () => {
    const { dts } = parse_dts_from_file("basic_types.dts");

    const model_property = dts.root.properties.find(p => p.name === "model");
    expect.assert.isDefined(model_property);

    expect(model_property.labels.length).toStrictEqual(1);
    expect(model_property.labels.at(0)).toStrictEqual("property_label");

    if (is_dt_flag(model_property.value)) {
      expect.fail("Unexpected flag property");
    }

    expect(model_property.value.length).toBeGreaterThan(0);
    expect(model_property.value[0].labels.length).toStrictEqual(1);
    expect(model_property.value[0].labels.at(0)).toStrictEqual("string_label");

    const bytes_property = dts.root.properties.find(p => p.name === "bytes");
    expect.assert.isDefined(bytes_property);

    if (is_dt_flag(bytes_property.value)) {
      expect.fail("Unexpected flag property");
    }

    expect(bytes_property.value.length).toBeGreaterThan(0);

    const bytestring = bytes_property.value.at(0);
    expect.assert.isDefined(bytestring);

    if (bytestring.kind !== "array") {
      expect.fail("Expected bytestring");
    }

    expect(bytestring.bit_width).toStrictEqual(8);
    expect(bytestring.elements.length).toBeGreaterThan(0);
    expect(bytestring.elements[0].labels.length).toStrictEqual(1);
    expect(bytestring.elements[0].labels[0]).toStrictEqual("byte_label");

    const interrupt_controller = dts.root.children.find(c => c.name === "interrupt-controller");
    expect.assert.isDefined(interrupt_controller);

    expect(interrupt_controller.labels.length).toStrictEqual(1);
    expect(interrupt_controller.labels[0]).toStrictEqual("mpic");
  });

  test('stack labels', () => {
    const { dts } = parse_dts_from_file("stack_labels.dts");

    const property = dts.root.properties.find(p => p.name === "prop");
    expect.assert.isDefined(property);

    expect(property.labels).not.toHaveLength(0);
    expect(property.labels.length).toStrictEqual(2);
    expect(property.labels[0]).toStrictEqual("second_label");
    expect(property.labels[1]).toStrictEqual("first_label");

    if (is_dt_flag(property.value)) {
      expect.fail("Unexpected flag property");
    }

    expect(property.value).not.toHaveLength(0);
    expect(property.value[0].labels).not.toHaveLength(0);
    expect(property.value[0].labels[0]).toStrictEqual("value_label2");

    const node = dts.root.children.find(c => c.name === "node");
    expect.assert.isDefined(node);

    expect(node.labels).toHaveLength(3);
    expect(node.labels.at(0)).toStrictEqual("c_label");
    expect(node.labels.at(1)).toStrictEqual("b_label");
    expect(node.labels.at(2)).toStrictEqual("a_label");
  });
});

describe("bad tokens", () => {

  test("simple bad char", () => {
    bad_tokens_test_impl("bad_character.dts");
  });

  test("missing version tag", () => {
    bad_tokens_test_impl("missing_version.dts");
  });

  describe("missing semicolons", () => {
    test("after version tag", () => {
      bad_tokens_test_impl("missing_semicolons/version_tag.dts");
    });

    test("after memreserve statement", () => {
      bad_tokens_test_impl("missing_semicolons/memreserve.dts");
    });

    test("after slash directive", () => {
      bad_tokens_test_impl("missing_semicolons/slash_directive.dts");
    });

    test("after property", () => {
      bad_tokens_test_impl("missing_semicolons/property.dts");
    });

    test("after node", () => {
      bad_tokens_test_impl("missing_semicolons/node.dts");
    });
  });

  test("0x-prefixed number in bytestring returns error", () => {
    bad_tokens_test_impl("bytestring_0x_prefix.dts");
  });

  test("0x-prefixed spaced bytes in bytestring returns error", () => {
    bad_tokens_test_impl("bytestring_0x_prefix_spaced.dts");
  });

  describe("extra semicolons", () => {
    test("after version tag", () => {
      bad_tokens_test_impl("extra_semicolons/version_tag.dts");
    });

    test("after memreserve statement", () => {
      bad_tokens_test_impl("extra_semicolons/memreserve.dts");
    });

    test("after slash directive", () => {
      bad_tokens_test_impl("extra_semicolons/slash_directive.dts");
    });

    test("after property", () => {
      bad_tokens_test_impl("extra_semicolons/property.dts");
    });

    test("after node", () => {
      bad_tokens_test_impl("extra_semicolons/node.dts");
    });
  });
});

describe("overlays (DTOs)", () => {
  test("label/path references become fragments", () => {
    const dto = parse_dto_from_file("dtso/references.dtso");

    expect(dto.root.properties).toHaveLength(0);
    expect(dto.root.children).toHaveLength(2);

    // fragment0

    const fragment0 = dto.root.children.find(c => c.name === "fragment" && c.unit_addr === "0");
    expect.assert.isDefined(fragment0);

    expect(fragment0.properties).toHaveLength(1);

    const target_path_property = fragment0.properties[0];
    expect(target_path_property.name).toStrictEqual("target-path");

    if (is_dt_flag(target_path_property.value)) {
      expect.fail("Unexpected empty property");
    }

    expect(target_path_property.value).toHaveLength(1);

    const target_path_value = target_path_property.value[0];
    if (target_path_value.kind !== "string") {
      expect.fail("Expected string value");
    }
    expect(target_path_value.value.startsWith("/"), "Expected valid path");

    expect(fragment0.children).toHaveLength(1);

    const overlay0 = fragment0.children.find(c => c.name === "__overlay__" && c.unit_addr === undefined);
    expect.assert.isDefined(overlay0);

    expect(overlay0.properties).toHaveLength(0);
    expect(overlay0.children).toHaveLength(1);

    const new_node0 = overlay0.children.find(c => c.name === "imu" && c.unit_addr === "1");
    expect.assert.isDefined(new_node0);
    expect(new_node0.properties).toHaveLength(2);

    // fragment@1

    const fragment1 = dto.root.children.find(c => c.name === "fragment" && c.unit_addr === "1");
    expect.assert.isDefined(fragment1);

    expect(fragment1.properties).toHaveLength(1);

    const target_property = fragment1.properties[0];
    expect(target_property.name).toStrictEqual("target");

    if (is_dt_flag(target_property.value)) {
      expect.fail("Unexpected empty property");
    }

    const target_value = target_property.value[0];
    if (target_value.kind !== "array") {
      expect.fail("Expected array value");
    }

    expect(target_value.bit_width).toStrictEqual(Bits.b32);
    expect(target_value.elements).toHaveLength(1);

    const label_reference = target_value.elements[0];
    if (label_reference.kind !== "label") {
      expect.fail("Expected label reference");
    }

    const overlay1 = fragment1.children.find(c => c.name === "__overlay__" && c.unit_addr === undefined);
    expect.assert.isDefined(overlay1);

    const new_node1 = overlay1.children.find(c => c.name === "imu" && c.unit_addr === "1");
    expect.assert.isDefined(new_node1);
    expect(new_node1.properties).toHaveLength(2);
  });

  test("fragments are correctly parsed", () => {
    const dto = parse_dto_from_file("dtso/fragments.dtso");

    expect(dto.root.properties).toHaveLength(0);
    expect(dto.root.children).toHaveLength(3);

    // fragment0

    const fragment0 = dto.root.children.find(c => c.name === "fragment" && c.unit_addr === "0");
    expect.assert.isDefined(fragment0);

    expect(fragment0.properties).toHaveLength(1);

    const target_path_property = fragment0.properties[0];
    expect(target_path_property.name).toStrictEqual("target-path");

    if (is_dt_flag(target_path_property.value)) {
      expect.fail("Unexpected empty property");
    }

    expect(target_path_property.value).toHaveLength(1);

    const target_path_value = target_path_property.value[0];
    if (target_path_value.kind !== "string") {
      expect.fail("Expected string value");
    }
    expect(target_path_value.value.startsWith("/"), "Expected valid path");

    expect(fragment0.children).toHaveLength(1);

    const overlay0 = fragment0.children.find(c => c.name === "__overlay__" && c.unit_addr === undefined);
    expect.assert.isDefined(overlay0);

    expect(overlay0.properties).toHaveLength(2);

    // fragment@1

    const fragment1 = dto.root.children.find(c => c.name === "fragment" && c.unit_addr === "1");
    expect.assert.isDefined(fragment1);

    expect(fragment1.properties).toHaveLength(1);

    const target_property = fragment1.properties[0];
    expect(target_property.name).toStrictEqual("target");

    if (is_dt_flag(target_property.value)) {
      expect.fail("Unexpected empty property");
    }

    const target_value = target_property.value[0];
    if (target_value.kind !== "array") {
      expect.fail("Expected string value");
    }

    expect(target_value.bit_width).toStrictEqual(Bits.b32);
    expect(target_value.elements).toHaveLength(1);

    const label_reference = target_value.elements[0];
    if (label_reference.kind !== "label") {
      expect.fail("Expected label reference");
    }

    const overlay1 = fragment1.children.find(c => c.name === "__overlay__" && c.unit_addr === undefined);
    expect.assert.isDefined(overlay1);

    expect(overlay1.properties).toHaveLength(2);

    // fragment@2

    const fragment2 = dto.root.children.find(c => c.name === "fragment" && c.unit_addr === "2");
    expect.assert.isDefined(fragment2);

    const overlay2 = fragment2.children.find(c => c.name === "__overlay__" && c.unit_addr === undefined);
    expect.assert.isDefined(overlay2);

    expect(overlay2.properties).toHaveLength(0);
    expect(overlay2.children).toHaveLength(1);
    expect(overlay2.children[0].properties).toHaveLength(2);
  });
});

describe("comments", () => {
  test("metadata is correctly parsed", () => {
    const source = fs.readFileSync(path.resolve(TEST_DTS_FILES_DIR_PATH, "comments.dts"), "utf8");
    const parse_result = parse_dts(source);
    if (Result.is_err(parse_result)) {
      expect.fail(`Failed to parse input file because: ${parse_result.error.message}`);
    }

    const { dts: dts1, metadata: metadata1 } = parse_result.value;
    if (!isDTMetadata(metadata1)) {
      expect.fail("Expected valid device tree metadata");
    }

    expect(metadata1.version).toStrictEqual("0.1.0");
    expect(metadata1.modifications).toHaveLength(4);

    for (let index = 0; index < metadata1.modifications.length; ++index) {
      expect(metadata1.modifications[index])
        .toStrictEqual(`/abs/path/to/modified/${index + 1}`);
    }

    const serialized_dts_with_metadata = print_dts(dts1, metadata1);
    const parse_result_from_serialized = parse_dts(serialized_dts_with_metadata);
    if (Result.is_err(parse_result_from_serialized)) {
      expect.fail("Failed to parse again what has been serialized");
    }

    const {
      dts: dts2,
      metadata: metadata2
    }
      = parse_result_from_serialized.value;

    expect(normalize(dts1))
      .toStrictEqual(normalize(dts2));

    expect(stringify_as_yaml(metadata1))
      .toStrictEqual(stringify_as_yaml(metadata2));
  });
});

describe("expressions", () => {
  test("simple parenthesized expression is parsed as expression element", () => {
    const { dts } = parse_dts_from_file("expression_simple.dts");

    const prop = dts.root.properties.find(p => p.name === "prop");
    expect.assert.isDefined(prop);

    if (is_dt_flag(prop.value)) {
      expect.fail("Expected non-empty property value");
    }

    expect(prop.value).toHaveLength(1);

    const component = prop.value[0];
    if (component.kind !== "array") {
      expect.fail("Expected cell array");
    }

    expect(component.elements).toHaveLength(1);

    const element = component.elements[0];
    if (element.kind !== "expression") {
      expect.fail("Expected expression element");
    }

    expect(element.value).toStrictEqual("(1+2)");
  });

  test("nested parentheses are tracked correctly", () => {
    const { dts } = parse_dts_from_file("expression_nested.dts");

    const prop = dts.root.properties.find(p => p.name === "prop");
    expect.assert.isDefined(prop);

    if (is_dt_flag(prop.value)) {
      expect.fail("Expected non-empty property value");
    }

    const component = prop.value[0];
    if (component.kind !== "array") {
      expect.fail("Expected cell array");
    }

    expect(component.elements).toHaveLength(1);

    const element = component.elements[0];
    if (element.kind !== "expression") {
      expect.fail("Expected expression element");
    }

    expect(element.value).toStrictEqual("((1+2)*3)");
  });

  test("unclosed parenthesis in expression returns error", () => {
    bad_tokens_test_impl("expression_unclosed.dts");
  });

  test("unparenthesized arithmetic in cell array returns error", () => {
    bad_tokens_test_impl("expression_unparenthesized.dts");
  });
});

// Utilities

function basic_round_trip_test_impl(filename: string) {
  const { dts: dts1, metadata: metadata1 } = parse_dts_from_file(filename);

  const serialized_dts = print_dts(dts1, metadata1);
  const second_parse_result = parse_dts(serialized_dts);
  if (Result.is_err(second_parse_result)) {
    expect.fail(`Parser failed: ${second_parse_result.error.message}`);
  }

  const { dts: dts2, metadata: metadata2 } = second_parse_result.value;

  expect(normalize(dts1))
    .toStrictEqual(normalize(dts2));

  expect(stringify_as_yaml(metadata1))
    .toStrictEqual(stringify_as_yaml(metadata2));
}

function bad_tokens_test_impl(filename: string) {
  const source = fs.readFileSync(path.resolve(TEST_DTS_FILES_DIR_PATH, filename), "utf8");
  const parse_result = parse_dts(source);
  if (Result.is_ok(parse_result)) {
    expect.fail("Should have failed to parse this file");
  }
}

function parse_dts_from_file(filename: string): DTSParseResult {
  const source = fs.readFileSync(path.resolve(TEST_DTS_FILES_DIR_PATH, filename), "utf8");
  const parse_result = parse_dts(source);
  if (Result.is_err(parse_result)) {
    expect.fail(`Failed to parse input file because: ${parse_result.error.message}`);
  }
  return parse_result.value;
}

function parse_dto_from_file(filename: string): DTO {
  const source = fs.readFileSync(path.resolve(TEST_DTS_FILES_DIR_PATH, filename), "utf8");
  const parse_result = parse_dto(source);
  if (Result.is_err(parse_result)) {
    expect.fail(`Failed to parse input file because: ${parse_result.error.message}`);
  }
  return parse_result.value.dto;
}

function normalize(document: DTS): any {
  return JSON.parse(JSON.stringify(document, (k, v) => typeof v === "bigint" ? v.toString() : v));
}
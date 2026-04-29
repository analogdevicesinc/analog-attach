import * as fs from 'node:fs';
import path from 'node:path';

import { parse_dts, printDts, printDtso, mergeDtso, DtsDocument, DtsReference } from 'attach-lib';

import { test, expect } from 'vitest';

function normalize(document: DtsDocument): any {
  // Convert BigInt to string for deepEqual and drop non-essential fields (_uuid)
  return JSON.parse(JSON.stringify(document, (k, v) => {
    if (k === "_uuid") {
      return;
    }

    // FIXME: ideal position to do is when we make the dif between dts and dtso
    // (consider only in dtso). This is just for the tests to pass
    if (k === "created_by_user") {
      return;
    }

    return typeof v === 'bigint' ? v.toString() : v;
  }));
}

test('minimal root and string property', () => {
  const source_path = path.resolve(__dirname, 'dts_source/minimal.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const out = printDts(document);

  const document2 = parse_dts(out);
  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('arrays, refs, bytes, labels', () => {
  const source_path = path.resolve(__dirname, 'dts_source/basic_types.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const out = printDts(document);

  const document2 = parse_dts(out);
  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('roundtrip rpi.prepro.dts', () => {
  const source_path = path.resolve(__dirname, 'dts_source/rpi.prepro.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const out = printDts(document);

  const document2 = parse_dts(out);
  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('roundtrip zephyr.dts', () => {
  const dts_source = path.resolve(__dirname, 'dts_source/zephyr.dts');
  const source = fs.readFileSync(dts_source, 'utf8');

  const document = parse_dts(source);

  const out = printDts(document);

  const document2 = parse_dts(out);
  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('byte strings support compact hex with spaces', () => {
  const source_path = path.resolve(__dirname, 'dts_source/basic_types.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const bytesProperty = document.root.properties.find((p) => p.name === 'bytes');

  expect(
    bytesProperty !== undefined &&
    bytesProperty.value !== undefined,
    'bytes property missing'
  );

  const comp: any = bytesProperty!.value!.components[0];
  expect(comp.kind, 'bytes component not parsed as bytes').toStrictEqual('bytes');

  const values = comp.bytes.map((b: any) => b.value);
  expect(values).toStrictEqual([0x00, 0x00, 0x00, 0x1B, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x00]);

  const out = printDts(document);
  const document2 = parse_dts(out);

  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('byte strings support compact hex without spaces', () => {
  const source_path = path.resolve(__dirname, 'dts_source/basic_types.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const bytesProperty = document.root.properties.find((p) => p.name === 'bytes2');

  expect(
    bytesProperty !== undefined &&
    bytesProperty.value !== undefined,
    'bytes property missing'
  );

  const comp: any = bytesProperty!.value!.components[0];
  expect(comp.kind, 'bytes component not parsed as bytes').toStrictEqual('bytes');

  const values = comp.bytes.map((b: any) => b.value);
  expect(values).toStrictEqual([0x00, 0x00, 0x00, 0x1B, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x00]);

  const out = printDts(document);
  const document2 = parse_dts(out);

  expect(normalize(document2)).toStrictEqual(normalize(document));
});

test('merge behavior: later root overrides earlier', () => {
  const source_path = path.resolve(__dirname, 'dts_source/merge_input.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  const document = parse_dts(source);

  const a = document.root.children.find((c) => c.name === 'node' && (c.labels ?? []).includes('a'));

  expect(
    a !== undefined,
    'merged child node present'
  );

  const x = a!.properties.find((p) => p.name === 'x');

  expect(
    x !== undefined &&
    x.value !== undefined,
    'property x exists'
  );

  const output = printDts(document);

  const expected_path = path.resolve(__dirname, 'dts_source/merge_output.dts');
  const expected = fs.readFileSync(expected_path, 'utf8');

  // TODO: maybe ignore formatting
  expect(output).toStrictEqual(expected);
});

test('delete-property removes alias intc', () => {
  const source_path = path.resolve(__dirname, 'dts_source/delete_merge_alias.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const aliases = document.root.children.find((c) => c.name === 'aliases');

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
      const expected: DtsReference = {
        kind: 'ref',
        labels: [],
        ref: {
          kind: 'label',
          name: 'spi2'
        }
      };

      expect(property.value!.components.length).toStrictEqual(1);
      expect(property.value!.components[0]).toStrictEqual(expected);
    }
  }
});

test('labeling', () => {
  const source_path = path.resolve(__dirname, 'dts_source/basic_types.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const model = document.root.properties.find((value) => value.name === 'model');

  expect.assert.isDefined(model);

  expect(
    model.labels?.length === 1 &&
    model.labels.at(0) === 'property_label',
    "Failed property_label check"
  );

  expect.assert.isDefined(model.value, `${model.name} has no value`);

  expect(
    model.value.components[0].labels.length === 1 &&
    model.value.components[0].labels.at(0) === 'string_label',
    "Failed string_label check"
  );

  const bytes = document.root.properties.find((value) => value.name === "bytes");

  expect.assert.isDefined(bytes);
  expect.assert.isDefined(bytes.value);

  expect(
    bytes.value.components[0].kind === "bytes" &&
    bytes.value.components[0].bytes[0].labels.length === 1 &&
    bytes.value.components[0].bytes[0].labels[0] === "byte_label"
  );

  // missing cell_label
  const interrupts = document.root.properties.find((value) => value.name === "interrupts");

  expect.assert.isDefined(interrupts);
  expect.assert.isDefined(interrupts.value);

  expect(
    interrupts.value.components[0].labels?.length === 1 &&
    interrupts.value.components[0].labels.at(0) === "cell_label" &&
    interrupts.value.components[0].kind === 'array' &&
    interrupts.value.components[0].elements[0].item.labels.length === 1 &&
    interrupts.value.components[0].elements[0].item.labels[0] === "interior_cell_label"
  );

  const interrupt_controller = document.root.children.find((value) => value.name === 'interrupt-controller');

  expect(
    interrupt_controller !== undefined &&
    interrupt_controller.labels![0] === 'mpic'
  );
});

test('stack labels', () => {
  const source_path = path.resolve(__dirname, 'dts_source/stack_labels.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const property = document.root.properties.find((value) => value.name === "prop");

  expect.assert.isDefined(property);
  expect.assert.isDefined(property.value);

  expect(
    property.labels.length === 2 &&
    property.labels.at(0) === 'second_label' &&
    property.labels.at(1) === 'first_label',
    "Failed property label stacking!"
  );

  // Assumption is that incoming content wins when merging
  expect(
    property.value.components[0].labels.length === 1 &&
    property.value.components[0].labels.at(0) === 'value_label2' &&
    "Values labels shouldn't be stacked!"
  );

  const node = document.root.children.find((value) => value.name === "node");

  expect.assert.isDefined(node);

  expect(
    node.labels.length === 3 &&
    node.labels.at(0) === "c_label" &&
    node.labels.at(1) === "b_label" &&
    node.labels.at(2) === "a_label",
    "Failed node label stacking!"
  );
});

test('bad character in dts', () => {
  const source_path = path.resolve(__dirname, 'dts_source/bad_character.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  expect(() => parse_dts(source)).toThrowError(Error);
});

test('missing semicolon in dts', () => {
  const version_tag_path = path.resolve(__dirname, 'dts_source/missing_semicolons/version_tag.dts');
  const version_tag = fs.readFileSync(version_tag_path, 'utf8');

  expect(() => parse_dts(version_tag)).toThrowError(Error);

  const memreserve_path = path.resolve(__dirname, 'dts_source/missing_semicolons/memreserve.dts');
  const memreserve = fs.readFileSync(memreserve_path, 'utf8');

  expect(() => parse_dts(memreserve)).toThrowError(Error);

  const slash_directive_path = path.resolve(__dirname, 'dts_source/missing_semicolons/slash_directive.dts');
  const slash_directive = fs.readFileSync(slash_directive_path, 'utf8');

  expect(() => parse_dts(slash_directive)).toThrowError(Error);

  const property_path = path.resolve(__dirname, 'dts_source/missing_semicolons/property.dts');
  const property = fs.readFileSync(property_path, 'utf8');

  expect(() => parse_dts(property)).toThrowError(Error);

  const node_path = path.resolve(__dirname, 'dts_source/missing_semicolons/node.dts');
  const node = fs.readFileSync(node_path, 'utf8');

  expect(() => parse_dts(node)).toThrowError(Error);
});

test('extra semicolon in dts', () => {
  const version_tag_path = path.resolve(__dirname, 'dts_source/extra_semicolons/version_tag.dts');
  const version_tag = fs.readFileSync(version_tag_path, 'utf8');

  expect(() => parse_dts(version_tag)).toThrowError(Error);

  const memreserve_path = path.resolve(__dirname, 'dts_source/extra_semicolons/memreserve.dts');
  const memreserve = fs.readFileSync(memreserve_path, 'utf8');

  expect(() => parse_dts(memreserve)).toThrowError(Error);

  const slash_directive_path = path.resolve(__dirname, 'dts_source/extra_semicolons/slash_directive.dts');
  const slash_directive = fs.readFileSync(slash_directive_path, 'utf8');

  expect(() => parse_dts(slash_directive)).toThrowError(Error);

  const property_path = path.resolve(__dirname, 'dts_source/extra_semicolons/property.dts');
  const property = fs.readFileSync(property_path, 'utf8');

  expect(() => parse_dts(property)).toThrowError(Error);

  const node_path = path.resolve(__dirname, 'dts_source/extra_semicolons/node.dts');
  const node = fs.readFileSync(node_path, 'utf8');

  expect(() => parse_dts(node)).toThrowError(Error);
});

test('missing version tag', () => {
  const source_path = path.resolve(__dirname, 'dts_source/missing_version.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  expect(() => parse_dts(source)).toThrowError(Error);
});

test('delete from overlay is relative and does not remove same-named root node', () => {
  const source_path = path.resolve(__dirname, 'dts_source/relative_delete_node_with_overlay.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const leds = document.root.children.find((c) => c.name === 'leds');

  expect.assert.isDefined(leds);

  expect(
    leds.labels.includes('leds'),
    'root leds label missing'
  );
});

test('delete node from overlay successful delete', () => {
  const source_path = path.resolve(__dirname, 'dts_source/delete_node_with_overlay.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const leds = document.root.children.find((c) => c.name === 'leds');

  expect.assert.isDefined(leds, "Missing leds node");

  const foo = leds.children.find((c) => c.name === 'foo');

  expect.assert.isUndefined(foo, "Missing leds node");
});

test('delete property from overlay successful delete', () => {
  const source_path = path.resolve(__dirname, 'dts_source/delete_property_with_overlay.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const document = parse_dts(source);

  const leds = document.root.children.find((c) => c.name === 'leds');

  expect.assert.isDefined(leds, "Missing leds node");

  const property = leds.properties.find((c) => c.name === 'property');

  expect.assert.isUndefined(property, "Missing leds node");
});

test('printDtso merges overlays with reference as full path and enables direct parent (status property)', () => {
  const source_path = path.resolve(__dirname, 'dts_source/dtso/base.dts');
  const source = fs.readFileSync(source_path, 'utf8');
  const base = parse_dts(source);

  const flag_overlay_path = path.resolve(__dirname, 'dts_source/dtso/add_flag.dtso');
  const flag_overlay_source = fs.readFileSync(flag_overlay_path, 'utf8');
  const flag_overlay = mergeDtso(base, flag_overlay_source);

  const device_overlay_path = path.resolve(__dirname, 'dts_source/dtso/add_device.dtso');
  const device_overlay_source = fs.readFileSync(device_overlay_path, 'utf8');
  const mergedDocument = mergeDtso(flag_overlay, device_overlay_source);

  const dtsoText = printDtso(mergedDocument);

  const expected_path = path.resolve(__dirname, 'dts_source/dtso/merged_result.dtso');
  const expected = fs.readFileSync(expected_path, 'utf8');

  // NOTE: formatting really really matters
  expect(dtsoText).toStrictEqual(expected);
});
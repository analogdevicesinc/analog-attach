import * as fs from 'node:fs';
import path from 'node:path';

import { parse_dts, search_node_in_dts } from 'attach-lib';

import { test, expect, describe } from 'vitest';

function parse_source(): ReturnType<typeof parse_dts> {
  const source_path = path.resolve(__dirname, 'dts_source/search_node.dts');
  const source = fs.readFileSync(source_path, 'utf8');

  return parse_dts(source);
}

describe('search_node_in_dts', () => {
  test('resolves &{/absolute/path}', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '&{/soc/spi@0/imu@0}');

    expect(result?.found_node.name).toBe('imu');
    expect(result?.found_node.unit_addr).toBe('0');
    expect(result?.parent_node?.name).toBe('spi');
  });

  test('resolves bare /absolute/path', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '/soc/spi@0');

    expect(result?.found_node.unit_addr).toBe('0');
    expect(result?.parent_node?.name).toBe('soc');
  });

  test('resolves &label', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '&imu1');

    expect(result?.found_node.labels).toContain('imu1');
    expect(result?.parent_node?.labels).toContain('spi0');
  });

  test('resolves bare label', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, 'spi0');

    expect(result?.found_node.labels).toContain('spi0');
    expect(result?.parent_node?.name).toBe('soc');
  });

  test('does not match a bare name with no label (soc)', () => {
    const document = parse_source();

    expect(search_node_in_dts(document, 'soc')).toBeUndefined();
  });

  test('does not match a bare name@unit_addr even if a differently-named label matches the node', () => {
    const document = parse_source();

    expect(search_node_in_dts(document, 'imu@0')).toBeUndefined();
  });

  test('parent field is the found node\'s own label when it has one', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '/soc/spi@0/imu@0');

    expect(result?.parent).toBe('imu1');
  });

  test('parent field falls back to computed path when no label', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '/soc');

    expect(result?.parent).toBe('/soc');
  });

  test('found_path is always the absolute path even when the node has a label (path lookup)', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '/soc/spi@0/imu@0');

    expect(result?.found_path).toBe('/soc/spi@0/imu@0');
  });

  test('found_path is always the absolute path even when the node has a label (label lookup)', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, '&imu1');

    expect(result?.found_path).toBe('/soc/spi@0/imu@0');
  });

  test('found_path includes unit_addr segments from ancestor nodes', () => {
    const document = parse_source();

    const result = search_node_in_dts(document, 'spi0');

    expect(result?.found_path).toBe('/soc/spi@0');
  });

  test('returns undefined for a path that does not exist', () => {
    const document = parse_source();

    expect(search_node_in_dts(document, '/soc/i2c@0')).toBeUndefined();
  });

  test('returns undefined for a label that does not exist', () => {
    const document = parse_source();

    expect(search_node_in_dts(document, '&nonexistent')).toBeUndefined();
  });

  test('returns undefined for a bare name that does not exist', () => {
    const document = parse_source();

    expect(search_node_in_dts(document, 'nonexistent')).toBeUndefined();
  });
});

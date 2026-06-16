import * as fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'vitest';
import { parse_binding } from '../../src/bindings_parser/binding_parser';
import { expectOk } from '../test_utils';

function findYamlFiles(directory: string): string[] {
	const files: string[] = [];
	const entries = fs.readdirSync(directory, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...findYamlFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.yaml')) {
			files.push(fullPath);
		}
	}

	return files;
}

const schemas_directory = path.resolve(__dirname, '../bindings/schemas');
const yamlFiles = findYamlFiles(schemas_directory);

describe('parse all schemas', () => {
	test.each(yamlFiles)('parses %s', (filePath) => {
		const content = fs.readFileSync(filePath, 'utf8');
		const result = parse_binding(content);
		expectOk(result);
	});
});

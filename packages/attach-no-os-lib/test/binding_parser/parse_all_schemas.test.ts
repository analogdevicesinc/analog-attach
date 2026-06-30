import * as fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'vitest';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { expectOk } from '../test_utilities';

function findYamlFiles(directory: string): string[] {
	const files: string[] = [];
	const entries = fs.readdirSync(directory, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...findYamlFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.yaml') && entry.name !== 'platform.yaml') {
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
		const result = parse_ruleset(content);
		expectOk(result);
	});
});

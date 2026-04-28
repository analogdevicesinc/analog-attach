/**
 * Shared test utilities for extension tests
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { DtsDocument, DtsNode, DtsProperty, ParsedBinding } from "attach-lib";
import type { InternalErrorPayload, WithInternalError } from "extension-protocol";
import type { CompatibleMapping } from "../src/utilities";
import { get_compatible_mapping } from "../src/utilities";
import { AttachSession } from "../src/AttachSession/AttachSession";
import {
    dtsProperty,
    dtsStringProperty,
    dtsNode,
    dtsValueComponent,
    dtsMultipleStringComponents
} from "../src/WebviewControllers/DtsAstBuilders";

export const TEST_STORAGE_PATH = path.resolve(__dirname, "../../test");
export const TEST_LINUX_BINDINGS_FOLDER = path.join(TEST_STORAGE_PATH, "schemas");
export const TEST_LINUX_PATH = path.resolve(__dirname, "../../test/linux");
export const TEST_DT_SCHEMA_PATH = path.resolve(__dirname, "../../test/dt-schema");

let cachedCompatibleMapping: CompatibleMapping[] | undefined;

/**
 * Get compatible mapping (cached for performance).
 */
export async function getCompatibleMapping(): Promise<CompatibleMapping[]> {
    if (!cachedCompatibleMapping) {
        cachedCompatibleMapping = await get_compatible_mapping(
            TEST_LINUX_BINDINGS_FOLDER,
            TEST_LINUX_PATH,
            TEST_DT_SCHEMA_PATH
        );
    }
    return cachedCompatibleMapping;
}

/**
 * Create a minimal empty DtsDocument.
 */
export function createEmptyDocument(): DtsDocument {
    return {
        memreserves: [],
        root: {
            name: "/",
            unit_addr: undefined,
            _uuid: crypto.randomUUID(),
            properties: [],
            children: [],
            labels: [],
            deleted: false,
            modified_by_user: true,
            created_by_user: true,
        },
        unresolved_overlays: [],
		metadata: undefined
    };
}

/**
 * Create a DtsNode with the specified properties.
 */
export function createTestNode(options: {
    name: string;
    unitAddr?: string;
    labels?: string[];
    properties?: Array<{ name: string; value: unknown }>;
    children?: DtsNode[];
}): DtsNode {
    const properties: DtsProperty[] = [];

    for (const property of options.properties ?? []) {
        if (property.value === undefined || property.value === true) {
            // Flag property
            properties.push(dtsProperty(property.name));
        } else if (typeof property.value === "string") {
            properties.push(dtsStringProperty(property.name, property.value));
        } else if (Array.isArray(property.value) && property.value.every(v => typeof v === "string")) {
            // String array - create multiple string components (e.g., grouped compatibles)
            const components = dtsMultipleStringComponents(property.value as string[]);
            properties.push(dtsProperty(property.name, ...components));
        } else {
            const component = dtsValueComponent(property.value);
            if (component) {
                properties.push(dtsProperty(property.name, component));
            } else {
                properties.push(dtsProperty(property.name));
            }
        }
    }

    return dtsNode({
        name: options.name,
        unitAddr: options.unitAddr,
        labels: options.labels,
        properties,
        children: options.children,
    });
}

/**
 * Create an AttachSession for testing.
 */
export function createTestAttachSession(options?: {
    deviceTree?: DtsDocument;
    compatibleMapping?: CompatibleMapping[];
    labelMap?: Map<string, string>;
}): AttachSession {
    return AttachSession.createTestSession(
        [],
        options?.compatibleMapping ?? [],
        options?.deviceTree ?? createEmptyDocument(),
        TEST_LINUX_BINDINGS_FOLDER,
        TEST_LINUX_PATH,
        TEST_DT_SCHEMA_PATH,
        options?.labelMap ?? new Map()
    );
}

/**
 * Create an AttachSession with compatible mapping loaded.
 */
export async function createTestAttachSessionWithBindings(options?: {
    deviceTree?: DtsDocument;
    labelMap?: Map<string, string>;
}): Promise<AttachSession> {
    const mapping = await getCompatibleMapping();
    return createTestAttachSession({
        deviceTree: options?.deviceTree,
        compatibleMapping: mapping,
        labelMap: options?.labelMap,
    });
}

/**
 * Get the test source directory (works for both source and compiled code).
 * When compiled, __dirname is 'out/test', but fixtures are in 'test/fixtures'.
 */
function getTestSourceDirectory(): string {
    // If we're in the 'out' directory, go back to the source 'test' directory
    if (__dirname.includes(path.sep + "out" + path.sep)) {
        return __dirname.replace(path.sep + "out" + path.sep + "test", path.sep + "test");
    }
    return __dirname;
}

/**
 * Load a JSON fixture file.
 */
export function loadFixture<T>(relativePath: string): T {
    const testDirectory = getTestSourceDirectory();
    const fullPath = path.resolve(testDirectory, relativePath);
    const content = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(content) as T;
}

/**
 * Save data to a fixture file (for generating fixtures).
 */
export function saveFixture(relativePath: string, data: unknown): void {
    const fullPath = path.resolve(__dirname, relativePath);
    const directory = path.dirname(fullPath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(data, bigIntReplacer, 2), "utf8");
}

/**
 * Compare actual value with fixture (with BigInt handling).
 */
export function assertMatchesFixture(actual: unknown, fixturePath: string): void {
    const expected = loadFixture(fixturePath);
    const normalizedActual = JSON.parse(JSON.stringify(actual, bigIntReplacer));
    const normalizedExpected = JSON.parse(JSON.stringify(expected, bigIntReplacer));
    assert.deepStrictEqual(normalizedActual, normalizedExpected);
}

/**
 * JSON replacer that converts BigInt to number.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return Number(value);
    }
    return value;
}

/**
 * Create a minimal binding for testing.
 */
export function createTestBinding(options?: {
    properties?: ParsedBinding["properties"];
    required_properties?: string[];
    pattern_properties?: ParsedBinding["pattern_properties"];
}): ParsedBinding {
    return {
        properties: options?.properties ?? [],
        required_properties: options?.required_properties ?? [],
        pattern_properties: options?.pattern_properties,
        examples: [],
    };
}

/**
 * Create a device tree with a simple hierarchy for testing.
 */
export function createTestDeviceTree(): DtsDocument {
    const document = createEmptyDocument();

    // Add an SPI parent node
    const spiNode = createTestNode({
        name: "spi",
        unitAddr: "0",
        labels: ["spi0"],
        properties: [
            { name: "#address-cells", value: [1] },
            { name: "#size-cells", value: [0] },
        ],
    });

    document.root.children.push(spiNode);

    return document;
}

/**
 * Add a device node to a parent in the device tree.
 */
export function addDeviceToTree(
    deviceTree: DtsDocument,
    parentPath: string,
    device: DtsNode
): void {
    const parent = findNodeByPath(deviceTree.root, parentPath);
    if (!parent) {
        throw new Error(`Parent node not found: ${parentPath}`);
    }
    parent.children.push(device);
}

/**
 * Find a node by path in the device tree.
 */
export function findNodeByPath(root: DtsNode, path: string): DtsNode | undefined {
    if (path === "/" || path === "") {
        return root;
    }

    const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
    let current = root;

    for (const segment of segments) {
        const child = current.children.find(c => {
            const seg = c.unit_addr ? `${c.name}@${c.unit_addr}` : c.name;
            return seg === segment;
        });
        if (!child) {
            return undefined;
        }
        current = child;
    }

    return current;
}

/**
 * Extract a property value from a DtsNode.
 */
export function getPropertyValue(node: DtsNode, propertyName: string): unknown {
    const property = node.properties.find(p => p.name === propertyName);
    if (!property) {
        return undefined;
    }
    if (!property.value) {
        return true; // Flag property
    }

    const session = createTestAttachSession();
    return session.parseDtsValue(property.value);
}

/**
 * Type guard to check if a payload is an InternalErrorPayload.
 */
export function isInternalError(payload: unknown): payload is InternalErrorPayload {
    return typeof payload === "object" && payload !== null && (payload as InternalErrorPayload).type === "InternalError";
}

/**
 * Assert that a payload is not an InternalErrorPayload and narrow the type.
 * Use this in tests to safely access response payload fields.
 */
export function assertSuccessPayload<T>(payload: WithInternalError<T>): asserts payload is T {
    if (isInternalError(payload)) {
        throw new Error("Expected successful payload but received InternalErrorPayload");
    }
}

// Re-export DtsAstBuilders for convenience
export { dtsProperty, dtsStringProperty, dtsNode, dtsValueComponent, dtsMultipleStringComponents } from "../src/WebviewControllers/DtsAstBuilders";

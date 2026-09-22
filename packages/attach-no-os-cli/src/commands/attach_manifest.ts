import fs from "node:fs";
import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    PROTOCOL_VERSION,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_VERSION,
    build_manifest,
    get_manifest_path,
} from "../protocol/manifest";

/**
 * `attach-noos attach-manifest` — the one command attach-meta calls by a fixed name.
 *
 * The contract is narrow: write the manifest somewhere and print its path, nothing else.
 * attach-meta trims stdout and treats the whole of it as a path, so anything else a human
 * might want to see goes to stderr (which attach-meta only reads when we exit non-zero).
 *
 * There is no `--json` here. The manifest *is* the JSON, and it is delivered as a file
 * rather than on stdout because attach-meta stores the path and the file's SHA-256, then
 * re-reads the file on every dispatch.
 */
export const attachManifestCommand = buildCommand<{ print?: boolean }, []>({
    docs: {
        brief: "Write the attach-meta manifest and print its path",
        fullDescription:
            "Writes the attach-meta command manifest to the config directory and prints its path.\n" +
            "Run by 'attach-meta init <binary>'; there is rarely a reason to run it by hand.\n" +
            "Use --print to see the manifest itself instead of writing it.",
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            print: {
                kind: "boolean",
                brief: "Print the manifest to stdout instead of writing it to disk",
                optional: true,
            },
        },
    },
    func: async (flags) => {
        const manifest = build_manifest();
        const serialized = `${JSON.stringify(manifest, undefined, 2)}\n`;

        if (flags.print) {
            console.log(serialized.trimEnd());
            return;
        }

        const manifest_path = get_manifest_path();
        fs.mkdirSync(path.dirname(manifest_path), { recursive: true });
        fs.writeFileSync(manifest_path, serialized, "utf8");

        const commands = Object.keys(manifest.commands).length;
        console.error(
            `${TOOL_NAME} ${TOOL_VERSION} (${TOOL_DESCRIPTION})\n` +
            `protocol ${PROTOCOL_VERSION}, ${commands} commands declared`
        );

        // The only thing on stdout.
        console.log(manifest_path);
    },
});

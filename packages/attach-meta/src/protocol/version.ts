const OUR_VERSION = "1.0.0";

export interface SemVersion {
    major: number;
    minor: number;
    patch: number;
}

export function parseSemVersion(s: string): SemVersion {
    const parts = s.split(".");
    if (parts.length !== 3) {
        throw new Error(`invalid semver: expected MAJOR.MINOR.PATCH, got '${s}'`);
    }

    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    const patch = Number(parts[2]);

    if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
        throw new TypeError(`invalid semver: non-integer component in '${s}'`);
    }

    return { major, minor, patch };
}

export function formatSemVersion(v: SemVersion): string {
    return `${v.major}.${v.minor}.${v.patch}`;
}

export function checkMajorMatch(toolVersion: string, binary: string): void {
    const tool = parseSemVersion(toolVersion);
    const ours = parseSemVersion(OUR_VERSION);

    if (tool.major !== ours.major) {
        throw new Error(
            `protocol version mismatch: '${binary}' reports '${toolVersion}', ` +
            `analog-attach is '${formatSemVersion(ours)}' — major version must match ` +
            `(got ${tool.major}, need ${ours.major})`,
        );
    }
}

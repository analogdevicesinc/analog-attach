import { parseSemVersion, checkMajorMatch } from "./version";

describe("parseSemVersion", () => {
    it("parses valid semver", () => {
        const v = parseSemVersion("1.2.3");
        expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it("rejects two-part version", () => {
        expect(() => parseSemVersion("1.2")).toThrow("invalid semver");
    });

    it("rejects non-numeric string", () => {
        expect(() => parseSemVersion("abc")).toThrow("invalid semver");
    });

    it("rejects non-integer component", () => {
        expect(() => parseSemVersion("1.2.x")).toThrow("invalid semver");
    });
});

describe("checkMajorMatch", () => {
    it("succeeds when major matches", () => {
        expect(() => checkMajorMatch("1.0.0", "test")).not.toThrow();
    });

    it("throws on major mismatch", () => {
        expect(() => checkMajorMatch("99.0.0", "test")).toThrow("protocol version mismatch");
    });
});

// The names closest to a mistyped one, for "did you mean" in a refusal: shared by the front
// end (setting keys, command words) and the backends (device types).

/** Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps. */
function distance(a: string, b: string): number {
    // rows[row][column]: the distance between a's first `row` characters and b's first `column`.
    const rows = Array.from({ length: a.length + 1 }, (_, row) => Array.from({ length: b.length + 1 }, (_, column) => {
        if (row === 0) { return column; }
        return column === 0 ? row : 0;
    }));
    for (let row = 1; row <= a.length; row++) {
        for (let column = 1; column <= b.length; column++) {
            const cost = a[row - 1] === b[column - 1] ? 0 : 1;
            let best = Math.min(rows[row - 1]![column]! + 1, rows[row]![column - 1]! + 1, rows[row - 1]![column - 1]! + cost);
            if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
                best = Math.min(best, rows[row - 2]![column - 2]! + 1);
            }
            rows[row]![column] = best;
        }
    }
    return rows[a.length]![b.length]!;
}

/**
 * The candidates closest to `input`, best first, at most `limit`: those a few edits away (a
 * third of the input's length, at least two), then those that contain it or that it starts
 * with. None when nothing is close: a wild guess helps less than the full list.
 */
export function closest_names(input: string, candidates: readonly string[], limit = 3): string[] {
    const typed = input.toLowerCase();
    const allowed = Math.max(2, Math.floor(typed.length / 3));
    const scored = [...new Set(candidates)].flatMap(candidate => {
        const name = candidate.toLowerCase();
        if (name === typed) { return []; }
        const edits = distance(typed, name);
        if (edits <= allowed) { return [{ candidate, score: edits }]; }
        if (typed.length >= 3 && (name.includes(typed) || typed.startsWith(name))) { return [{ candidate, score: allowed + 1 }]; }
        return [];
    });
    return scored.toSorted((x, y) => x.score - y.score || x.candidate.localeCompare(y.candidate)).slice(0, limit).map(entry => entry.candidate);
}

/** ` Did you mean <a>, <b>?`, or nothing when no candidate is close. */
export function did_you_mean(input: string, candidates: readonly string[]): string {
    const close = closest_names(input, candidates);
    return close.length === 0 ? "" : ` Did you mean ${close.join(", ")}?`;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("closest_names - a few edits away, then containing; none when nothing is close", () => {
        expect(closest_names("targt", ["target", "probe", "workfile"])).toEqual(["target"]);
        expect(closest_names("testpar", ["testpart", "eval-testpart", "test_gpio_pin"])).toEqual(["testpart", "eval-testpart"]);
        expect(closest_names("porbe", ["probe", "project-name"])).toEqual(["probe"]);
        expect(closest_names("zzzzzz", ["target", "probe"])).toEqual([]);
        expect(closest_names("target", ["target"])).toEqual([]);
    });

    test("did_you_mean - the sentence, or nothing", () => {
        expect(did_you_mean("targt", ["target"])).toBe(" Did you mean target?");
        expect(did_you_mean("zzzzzz", ["target"])).toBe("");
    });
}

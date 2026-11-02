#!/usr/bin/env python3
"""
The functional tests' report: which requirements were tested, in which ecosystem, and how
it went.

It joins three things:
  - the tests' tags, read from the .bats files: `# bats test_tags=req:CONFIG-04` above a test,
    `# bats file_tags=eco:noos` for a file (or the ecosystem from its folder, noos/ or linux/),
    and `gap` for a known gap (a requirement the CLI doesn't meet yet);
  - bats' JUnit results (`--report-formatter junit`): pass, fail or skipped per test;
  - the requirements (docs/requirements.csv, from cli-spec.xlsx).

A test's status is pass, fail, skipped or not run, and `gap` for a known gap that fails: a
known issue, not a failure, listed so it isn't forgotten. A known gap that passes is a pass,
noted "fixed: drop the gap tag". A requirement's status in an ecosystem is fail if one of its
tests failed, else gap if one is a known gap, else pass if one passed, else skipped, and not
tested when none ran.

It writes, in the output directory:
  - tests.csv         one row per test: its file, name, ecosystem, requirements, status;
  - requirements.csv  one row per requirement: its status in each ecosystem it applies to
                      ('-' where it doesn't apply), and how many tests check it;
  - summary.md        the counts, and the requirements that fail, are known gaps or aren't
                      tested, in Markdown (a CI run's summary);
  - report.xlsx       the two tables as sheets, when openpyxl is installed.

It exits 1 when a test names a requirement that doesn't exist, so a renamed requirement
can't leave a stale test behind, and when bats ran fewer tests than --expected (the count
bats --count gives for the same run): a run that stopped early, a full disk say, isn't a
pass. With --fail-unless-gap it also exits 1 when a test fails that isn't a known gap (CI:
the known gaps don't fail the run). A test with no requirement is only listed.

    report.py --junit out/report.xml --tests test/functional --requirements docs/requirements.csv --out out noos linux
"""

import argparse
import csv
import pathlib
import re
import sys
import xml.etree.ElementTree as ElementTree

ECOSYSTEMS = ["linux", "noos"]
# The Ecosystems column of the requirements, as the ecosystems a requirement applies to.
APPLIES = {"All": ECOSYSTEMS, "Linux": ["linux"], "CAPI": ["noos"]}
GAP_TAG = "gap"
FIXED_NOTE = "fixed: drop the gap tag"

TAGS_LINE = re.compile(r"^\s*#\s*bats\s+(test_tags|file_tags)\s*=\s*(.*)$")
TEST_LINE = re.compile(r"^\s*@test\s+(['\"])(.*)\1\s*\{")


def split_tags(text):
    return [tag.strip() for tag in text.split(",") if tag.strip()]


def read_tests(root):
    """Every test of the .bats files under root: {(relative file, name): {"eco", "reqs", "gap"}}."""
    tests = {}
    for file in sorted(root.rglob("*.bats")):
        relative = file.relative_to(root).as_posix()
        file_tags, pending = [], []
        for line in file.read_text(encoding="utf-8").splitlines():
            tags = TAGS_LINE.match(line)
            if tags:
                (file_tags if tags.group(1) == "file_tags" else pending).extend(split_tags(tags.group(2)))
                continue
            test = TEST_LINE.match(line)
            if test:
                all_tags = file_tags + pending
                pending = []
                eco = next((tag[4:] for tag in all_tags if tag.startswith("eco:")), file.parent.name)
                reqs = [tag[4:] for tag in all_tags if tag.startswith("req:")]
                # The name as bats reports it: a double-quoted name has its shell escapes undone.
                name = test.group(2)
                if test.group(1) == '"':
                    name = re.sub(r'\\([$`"\\])', r"\1", name)
                tests[(relative, name)] = {"eco": eco, "reqs": reqs, "gap": GAP_TAG in all_tags}
    return tests


def test_file(classname, root, targets):
    """The .bats file a JUnit classname names, relative to root. bats writes it relative to the
    first folder it was given and absolute for the others, so it is resolved against each."""
    path = pathlib.Path(classname)
    bases = [root, *((target if target.is_dir() else target.parent) for target in targets)]
    for candidate in ([path] if path.is_absolute() else [base / path for base in bases]):
        if candidate.is_file():
            return candidate.resolve().relative_to(root.resolve()).as_posix()
    return classname


def read_results(junit, root, targets):
    """bats' JUnit: {(file relative to root, name): (status, message, seconds)}."""
    results = {}
    for case in ElementTree.parse(junit).getroot().iter("testcase"):
        failure = case.find("failure")
        skipped = case.find("skipped")
        if failure is not None:
            status, message = "fail", (failure.text or "").strip()
        elif skipped is not None:
            status, message = "skipped", (skipped.get("message") or skipped.text or "").strip()
        else:
            status, message = "pass", ""
        results[(test_file(case.get("classname"), root, targets), case.get("name"))] = (status, message, case.get("time", ""))
    return results


def test_status(raw, gap):
    """A test's status in the report: a known gap that fails is `gap`, not a failure."""
    return "gap" if gap and raw == "fail" else raw


def combined(statuses):
    """One status for a requirement in an ecosystem, from its tests' statuses."""
    if not statuses:
        return "not tested"
    for status in ("fail", "gap", "pass"):
        if status in statuses:
            return status
    return "skipped"


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def plural(count, word):
    return f"{count} {word}" + ("" if count == 1 else "s")


def write_summary(path, counts, requirement_rows, notes):
    """summary.md: the counts, per ecosystem too, then the requirements a reader should look at:
    those failing, those with a known gap, and those no ecosystem they apply to tests yet."""
    lines = ["## Functional tests", "",
             f"Tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped", ""]
    lines += ["| Ecosystem | Requirements | Tested | Pass | Fail | Known gaps | Skipped |", "|---|---|---|---|---|---|---|"]
    for index, eco in enumerate(ECOSYSTEMS):
        column = [row[5 + index] for row in requirement_rows if row[5 + index] != "-"]
        tested = sum(1 for status in column if status != "not tested")
        lines.append(f"| {eco} | {len(column)} | {tested} | {column.count('pass')} | {column.count('fail')} | {column.count('gap')} | {column.count('skipped')} |")
    lines.append("")
    sections = (
        ("Failing", lambda statuses: "fail" in statuses),
        ("Known gaps", lambda statuses: "gap" in statuses),
        ("Not tested in any ecosystem it applies to", lambda statuses: all(status in ("-", "not tested") for status in statuses)),
    )
    for title, wanted in sections:
        rows = [row for row in requirement_rows if wanted(row[5:7])]
        if not rows:
            continue
        lines += [f"### {title} ({len(rows)})", "", "| ID | Name | linux | noos |", "|---|---|---|---|"]
        lines += [f"| {row[0]} | {row[2]} | {row[5]} | {row[6]} |" for row in rows]
        lines.append("")
    if notes:
        lines += ["### Notes", "", *(f"- {note}" for note in notes), ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_xlsx(path, sheets):
    """Each sheet a (title, header, rows); colour the statuses. Skipped without openpyxl."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
    except ImportError:
        return False
    fills = {"pass": "d1fae5", "fail": "fee2e2", "gap": "fed7aa", "skipped": "fef9c3", "not tested": "f3f4f6"}
    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, header, rows in sheets:
        sheet = workbook.create_sheet(title)
        sheet.append(header)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append(row)
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                if cell.value in fills:
                    cell.fill = PatternFill("solid", fgColor=fills[cell.value])
        sheet.freeze_panes = "B2"
        sheet.auto_filter.ref = sheet.dimensions
    workbook.save(path)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--junit", required=True, type=pathlib.Path)
    parser.add_argument("--tests", required=True, type=pathlib.Path, help="the folder of the .bats files")
    parser.add_argument("--requirements", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--fail-unless-gap", action="store_true", help="exit 1 when a test fails that isn't a known gap")
    parser.add_argument("--expected", type=int, help="how many tests bats was to run; exit 1 when it ran fewer")
    parser.add_argument("targets", nargs="*", type=pathlib.Path, help="the files and folders bats ran, relative to --tests")
    args = parser.parse_args()

    with open(args.requirements, encoding="utf-8") as handle:
        requirements = list(csv.DictReader(handle))
    known = {row["ID"] for row in requirements}
    tests = read_tests(args.tests)
    targets = [target if target.is_absolute() else args.tests / target for target in args.targets]
    results = read_results(args.junit, args.tests, targets) if args.junit.exists() else {}

    test_rows = []
    by_requirement = {}  # (id, eco) -> [status]
    unknown, untagged, fixed = [], [], []
    for (file, name), test in tests.items():
        raw, message, seconds = results.get((file, name), ("not run", "", ""))
        status = test_status(raw, test["gap"])
        note = message.splitlines()[0] if message else ""
        if test["gap"] and raw == "pass":
            note = FIXED_NOTE
            fixed.append(f"{file}: {name}")
        test_rows.append([file, name, test["eco"], " ".join(test["reqs"]), status, "yes" if test["gap"] else "", seconds, note])
        if not test["reqs"]:
            untagged.append(f"{file}: {name}")
        for req in test["reqs"]:
            if req not in known:
                unknown.append(f"{file}: {name}: {req}")
            if status != "not run":
                by_requirement.setdefault((req, test["eco"]), []).append(status)

    requirement_rows = []
    for row in requirements:
        applies = APPLIES.get(row["Ecosystems"], ECOSYSTEMS)
        statuses = [combined(by_requirement.get((row["ID"], eco), [])) if eco in applies else "-" for eco in ECOSYSTEMS]
        count = sum(len(by_requirement.get((row["ID"], eco), [])) for eco in ECOSYSTEMS)
        requirement_rows.append([row["ID"], row["Command"], row["Name"], row["Ecosystems"], row["Basis"], *statuses, count])

    args.out.mkdir(parents=True, exist_ok=True)
    test_header = ["File", "Test", "Ecosystem", "Requirements", "Status", "Known gap", "Seconds", "Message"]
    requirement_header = ["ID", "Command", "Name", "Ecosystems", "Basis", *ECOSYSTEMS, "Tests"]
    write_csv(args.out / "tests.csv", test_header, test_rows)
    write_csv(args.out / "requirements.csv", requirement_header, requirement_rows)
    xlsx = write_xlsx(args.out / "report.xlsx", [("Requirements", requirement_header, requirement_rows), ("Tests", test_header, test_rows)])

    statuses = [row[4] for row in test_rows]
    applicable = [status for row in requirement_rows for status in row[5:7] if status != "-"]
    tested = sum(1 for row in requirement_rows if any(status not in ("-", "not tested") for status in row[5:7]))
    counts = {status: statuses.count(status) for status in ("pass", "fail", "gap", "skipped", "not run")}
    counts.update(tested=tested, requirements=len(requirement_rows))
    # bats stopping early leaves the tests it didn't get to out of the JUnit, as if filtered out.
    incomplete = args.expected is not None and len(results) < args.expected
    stopped = f"bats ran {len(results)} of the {args.expected} tests it was to run: the run stopped early"
    notes = ([f"error: {stopped}"] if incomplete else []) \
        + [f"unknown requirement: {line}" for line in unknown] + [f"{FIXED_NOTE}: {line}" for line in fixed]
    write_summary(args.out / "summary.md", counts, requirement_rows, notes)

    print(f"tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped"
          + (f", {counts['not run']} not run" if counts["not run"] else ""))
    print(f"requirements: {tested} of {len(requirement_rows)} tested ({applicable.count('pass')} pass, {applicable.count('fail')} fail, "
          f"{plural(applicable.count('gap'), 'known gap')}, {applicable.count('skipped')} skipped per ecosystem)")
    print(f"report: {args.out / 'requirements.csv'}, {args.out / 'tests.csv'}, {args.out / 'summary.md'}"
          + (f", {args.out / 'report.xlsx'}" if xlsx else ""))
    for line in untagged:
        print(f"warning: no requirement: {line}", file=sys.stderr)
    for line in fixed:
        print(f"note: a known gap passes, {FIXED_NOTE}: {line}", file=sys.stderr)
    for line in unknown:
        print(f"error: unknown requirement: {line}", file=sys.stderr)
    if incomplete:
        print(f"error: {stopped}", file=sys.stderr)
    failed = args.fail_unless_gap and counts["fail"] > 0
    return 1 if unknown or incomplete or failed else 0


if __name__ == "__main__":
    sys.exit(main())

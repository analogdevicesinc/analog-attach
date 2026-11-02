#!/usr/bin/env python3
"""
The functional tests' report: which requirements were tested, in which ecosystem, and how
it went.

It joins three things:
  - the tests' tags, read from the .bats files: `# bats test_tags=req:CONFIG-04, id:N0012`
    above a test, `# bats file_tags=eco:noos` for a file (or the ecosystem from its folder,
    noos/ or linux/), and `gap` for a known gap (a requirement the CLI doesn't meet yet);
    and their comments: `# Description:` and `# Steps:` above a test, `# Preconditions:` once
    per file, before its first test;
  - bats' JUnit results (`--report-formatter junit`): pass, fail or skipped per test;
  - the requirements (docs/requirements.csv, from cli-spec.xlsx).

A test's status is pass, fail, skipped or not run, and `gap` for a known gap that fails: a
known issue, not a failure, listed so it isn't forgotten. A known gap that passes is a pass,
noted "fixed: drop the gap tag". A requirement's status in an ecosystem is fail if one of its
tests failed, else gap if one is a known gap, else pass if one passed, else skipped, and not
tested when none ran.

It writes, in the output directory:
  - tests.csv         one row per test: its ID, file, name, description, preconditions, steps,
                      ecosystem, requirements, status;
  - requirements.csv  one row per requirement: its status in each ecosystem it applies to
                      ('-' where it doesn't apply), how many tests check it and their IDs,
                      and the IDs of those failing or known gaps;
  - summary.md        the counts, and the requirements that fail, are known gaps or aren't
                      tested, with the IDs of the tests concerned, in Markdown (a CI run's
                      summary);
  - report.xlsx       the two tables as sheets, when openpyxl is installed.

A test's ID is N and 4 digits in noos, L and 4 digits in linux (N0001, L0123), unique, and
never reused or renumbered: it names the test in the reports whatever its file or name.

It exits 1 when a test names a requirement that doesn't exist, so a renamed requirement
can't leave a stale test behind; when a test has no ID, a malformed one, one of the other
ecosystem's prefix, or one another test has; and when bats ran fewer tests than --expected
(the count bats --count gives for the same run): a run that stopped early, a full disk say,
isn't a pass. With --fail-unless-gap it also exits 1 when a test fails that isn't a known
gap (CI: the known gaps don't fail the run). A test with no requirement is only listed. Every
test must have a description and steps, and every file preconditions: until they are all
written, a test missing one is only counted (listed with --verbose), and an error with
--require-steps.

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
# The report.xlsx columns whose text wraps, and their widths (in characters).
WIDE = {"Description": 50, "Preconditions": 40, "Steps": 70, "Test IDs": 30, "Failing/gap IDs": 20}
FIXED_NOTE = "fixed: drop the gap tag"

TAGS_LINE = re.compile(r"^\s*#\s*bats\s+(test_tags|file_tags)\s*=\s*(.*)$")
TEST_LINE = re.compile(r"^\s*@test\s+(['\"])(.*)\1\s*\{")
# A test's ID: its ecosystem's prefix and 4 digits.
ID_LINE = re.compile(r"^[NL][0-9]{4}$")
ID_PREFIX = {"noos": "N", "linux": "L"}
# The comments a test or a file is described with: `# Description: text`, `# Steps:` then
# `#   1. text` per step, `# Preconditions: text`. A field runs on over the comment lines
# after it, up to the next field, another note (`# Gap: ...`, one word and a colon), the tags
# line, or a line that isn't a comment.
COMMENT_LINE = re.compile(r"^\s*#(?:\s(.*))?$")
FIELD_LINE = re.compile(r"^(Description|Steps|Preconditions):\s*(.*)$")
NOTE_LINE = re.compile(r"^[A-Z][\w-]*:(\s|$)")
STEP_LINE = re.compile(r"^\s*([0-9]+)\.\s+(.*)$")


def split_tags(text):
    return [tag.strip() for tag in text.split(",") if tag.strip()]


def add_text(text, more):
    """A field's text with a continuation line joined on with a space."""
    return f"{text} {more}" if text and more else text or more


def read_tests(root):
    """Every test of the .bats files under root: {(relative file, name): {"id", "eco", "reqs",
    "gap", "description", "steps", "preconditions"}}. steps is a list, "1. text" per step, as
    numbered in the file; the others are text ("" when missing)."""
    tests = {}
    for file in sorted(root.rglob("*.bats")):
        relative = file.relative_to(root).as_posix()
        file_tags, pending = [], []
        # The fields read since the last test, and the one a continuation line goes on.
        preconditions, fields, field = "", {"Description": "", "Steps": []}, None
        for line in file.read_text(encoding="utf-8").splitlines():
            tags = TAGS_LINE.match(line)
            if tags:
                (file_tags if tags.group(1) == "file_tags" else pending).extend(split_tags(tags.group(2)))
                field = None
                continue
            comment = COMMENT_LINE.match(line)
            if comment:
                text = comment.group(1) or ""
                start = FIELD_LINE.match(text)
                if start:
                    field = start.group(1)
                    if field == "Preconditions":
                        preconditions = start.group(2).strip()
                    elif field == "Description":
                        fields[field] = start.group(2).strip()
                    else:
                        fields[field] = []
                elif NOTE_LINE.match(text) or not text.strip():
                    field = None
                elif field == "Preconditions":
                    preconditions = add_text(preconditions, text.strip())
                elif field == "Description":
                    fields[field] = add_text(fields[field], text.strip())
                elif field == "Steps":
                    step = STEP_LINE.match(text)
                    if step:
                        fields[field].append(f"{step.group(1)}. {step.group(2).strip()}")
                    elif fields[field]:
                        fields[field][-1] = add_text(fields[field][-1], text.strip())
                continue
            field = None
            test = TEST_LINE.match(line)
            if test:
                all_tags = file_tags + pending
                pending = []
                eco = next((tag[4:] for tag in all_tags if tag.startswith("eco:")), file.parent.name)
                reqs = [tag[4:] for tag in all_tags if tag.startswith("req:")]
                ids = [tag[3:] for tag in all_tags if tag.startswith("id:")]
                # The name as bats reports it: a double-quoted name has its shell escapes undone.
                name = test.group(2)
                if test.group(1) == '"':
                    name = re.sub(r'\\([$`"\\])', r"\1", name)
                tests[(relative, name)] = {"id": " ".join(ids), "eco": eco, "reqs": reqs, "gap": GAP_TAG in all_tags,
                                           "description": fields["Description"], "steps": fields["Steps"]}
                fields = {"Description": "", "Steps": []}
        # The file's preconditions apply to all its tests, wherever they were written.
        for (test_file_name, _), test in tests.items():
            if test_file_name == relative:
                test["preconditions"] = preconditions
    return tests


def id_errors(tests):
    """What is wrong with the tests' IDs: a test with none (or several), a malformed one, one
    of the other ecosystem's prefix, or one two tests have."""
    errors, seen = [], {}
    for (file, name), test in tests.items():
        test_id = test["id"]
        if not test_id:
            errors.append(f"no id: {file}: {name}")
        elif not ID_LINE.match(test_id):
            errors.append(f"malformed id {test_id} (N or L and 4 digits): {file}: {name}")
        elif test["eco"] in ID_PREFIX and test_id[0] != ID_PREFIX[test["eco"]]:
            errors.append(f"id {test_id} in a {test['eco']} test, its ids start with {ID_PREFIX[test['eco']]}: {file}: {name}")
        if test_id:
            seen.setdefault(test_id, []).append(f"{file}: {name}")
    for test_id, where in seen.items():
        if len(where) > 1:
            errors.append(f"duplicate id {test_id}: " + "; ".join(where))
    return errors


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


def write_summary(path, counts, requirement_rows, ids_by_status, notes):
    """summary.md: the counts, per ecosystem too, then the requirements a reader should look at:
    those failing, with the IDs of their failing tests, those with a known gap, with the IDs
    of those, and those no ecosystem they apply to tests yet. ids_by_status: {requirement:
    {status: [test ID]}}."""
    lines = ["## Functional tests", "",
             f"Tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped", ""]
    lines += ["| Ecosystem | Requirements | Tested | Pass | Fail | Known gaps | Skipped |", "|---|---|---|---|---|---|---|"]
    for index, eco in enumerate(ECOSYSTEMS):
        column = [row[5 + index] for row in requirement_rows if row[5 + index] != "-"]
        tested = sum(1 for status in column if status != "not tested")
        lines.append(f"| {eco} | {len(column)} | {tested} | {column.count('pass')} | {column.count('fail')} | {column.count('gap')} | {column.count('skipped')} |")
    lines.append("")
    # Each section's requirements, and the status of their tests it lists the IDs of.
    sections = (
        ("Failing", lambda statuses: "fail" in statuses, "fail", "Failing tests"),
        ("Known gaps", lambda statuses: "gap" in statuses, "gap", "Gap tests"),
        ("Not tested in any ecosystem it applies to", lambda statuses: all(status in ("-", "not tested") for status in statuses), None, None),
    )
    for title, wanted, status, column in sections:
        rows = [row for row in requirement_rows if wanted(row[5:7])]
        if not rows:
            continue
        extra = [column] if column else []
        lines += [f"### {title} ({len(rows)})", "", "| " + " | ".join(["ID", "Name", "linux", "noos", *extra]) + " |",
                  "|" + "---|" * (4 + len(extra))]
        for row in rows:
            ids = [" ".join(ids_by_status.get(row[0], {}).get(status, []))] if column else []
            lines.append("| " + " | ".join([row[0], row[2], row[5], row[6], *ids]) + " |")
        lines.append("")
    if notes:
        lines += ["### Notes", "", *(f"- {note}" for note in notes), ""]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_xlsx(path, sheets):
    """Each sheet a (title, header, rows); colour the statuses. The long text columns (WIDE)
    wrap, top-aligned, and Excel sizes their rows. Skipped without openpyxl."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
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
        wide = {index for index, name in enumerate(header) if name in WIDE}
        for row in sheet.iter_rows(min_row=2):
            for index, cell in enumerate(row):
                if cell.value in fills:
                    cell.fill = PatternFill("solid", fgColor=fills[cell.value])
                cell.alignment = Alignment(vertical="top", wrap_text=index in wide)
        for index, name in enumerate(header):
            if name in WIDE:
                sheet.column_dimensions[get_column_letter(index + 1)].width = WIDE[name]
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
    parser.add_argument("--require-steps", action="store_true", help="exit 1 when a test has no description, steps or preconditions")
    parser.add_argument("--verbose", action="store_true", help="list each test with no description, steps or preconditions")
    parser.add_argument("targets", nargs="*", type=pathlib.Path, help="the files and folders bats ran, relative to --tests")
    args = parser.parse_args()

    with open(args.requirements, encoding="utf-8") as handle:
        requirements = list(csv.DictReader(handle))
    known = {row["ID"] for row in requirements}
    tests = read_tests(args.tests)
    targets = [target if target.is_absolute() else args.tests / target for target in args.targets]
    results = read_results(args.junit, args.tests, targets) if args.junit.exists() else {}

    bad_ids = id_errors(tests)
    test_rows = []
    by_requirement = {}  # (id, eco) -> [status]
    ids_by_status = {}  # requirement -> {status: [test ID]}
    unknown, untagged, fixed, undescribed = [], [], [], []
    for (file, name), test in tests.items():
        raw, message, seconds = results.get((file, name), ("not run", "", ""))
        status = test_status(raw, test["gap"])
        note = message.splitlines()[0] if message else ""
        if test["gap"] and raw == "pass":
            note = FIXED_NOTE
            fixed.append(f"{file}: {name}")
        test_rows.append([test["id"], file, name, test["description"], test["preconditions"], "\n".join(test["steps"]),
                          test["eco"], " ".join(test["reqs"]), status, "yes" if test["gap"] else "", seconds, note])
        if not test["reqs"]:
            untagged.append(f"{file}: {name}")
        missing = [what for what, text in (("description", test["description"]), ("steps", test["steps"]),
                                           ("preconditions", test["preconditions"])) if not text]
        if missing:
            undescribed.append(f"{', no '.join(missing)}: {test['id'] or '-'} {file}: {name}")
        for req in test["reqs"]:
            if req not in known:
                unknown.append(f"{file}: {name}: {req}")
            if test["id"]:
                ids_by_status.setdefault(req, {}).setdefault("all", []).append(test["id"])
                ids_by_status[req].setdefault(status, []).append(test["id"])
            if status != "not run":
                by_requirement.setdefault((req, test["eco"]), []).append(status)

    requirement_rows = []
    for row in requirements:
        applies = APPLIES.get(row["Ecosystems"], ECOSYSTEMS)
        statuses = [combined(by_requirement.get((row["ID"], eco), [])) if eco in applies else "-" for eco in ECOSYSTEMS]
        count = sum(len(by_requirement.get((row["ID"], eco), [])) for eco in ECOSYSTEMS)
        ids = ids_by_status.setdefault(row["ID"], {})
        failing = ids.get("fail", []) + ids.get("gap", [])
        requirement_rows.append([row["ID"], row["Command"], row["Name"], row["Ecosystems"], row["Basis"], *statuses, count,
                                 " ".join(ids.get("all", [])), " ".join(failing)])

    args.out.mkdir(parents=True, exist_ok=True)
    test_header = ["ID", "File", "Test", "Description", "Preconditions", "Steps", "Ecosystem", "Requirements", "Status",
                   "Known gap", "Seconds", "Message"]
    requirement_header = ["ID", "Command", "Name", "Ecosystems", "Basis", *ECOSYSTEMS, "Tests", "Test IDs", "Failing/gap IDs"]
    write_csv(args.out / "tests.csv", test_header, test_rows)
    write_csv(args.out / "requirements.csv", requirement_header, requirement_rows)
    xlsx = write_xlsx(args.out / "report.xlsx", [("Requirements", requirement_header, requirement_rows), ("Tests", test_header, test_rows)])

    statuses = [row[test_header.index("Status")] for row in test_rows]
    applicable = [status for row in requirement_rows for status in row[5:7] if status != "-"]
    tested = sum(1 for row in requirement_rows if any(status not in ("-", "not tested") for status in row[5:7]))
    counts = {status: statuses.count(status) for status in ("pass", "fail", "gap", "skipped", "not run")}
    counts.update(tested=tested, requirements=len(requirement_rows))
    # bats stopping early leaves the tests it didn't get to out of the JUnit, as if filtered out.
    incomplete = args.expected is not None and len(results) < args.expected
    stopped = f"bats ran {len(results)} of the {args.expected} tests it was to run: the run stopped early"
    notes = ([f"error: {stopped}"] if incomplete else []) \
        + [f"unknown requirement: {line}" for line in unknown] + [f"error: {line}" for line in bad_ids] \
        + [f"{FIXED_NOTE}: {line}" for line in fixed]
    write_summary(args.out / "summary.md", counts, requirement_rows, ids_by_status, notes)

    print(f"tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped"
          + (f", {counts['not run']} not run" if counts["not run"] else ""))
    print(f"requirements: {tested} of {len(requirement_rows)} tested ({applicable.count('pass')} pass, {applicable.count('fail')} fail, "
          f"{plural(applicable.count('gap'), 'known gap')}, {applicable.count('skipped')} skipped per ecosystem)")
    print(f"report: {args.out / 'requirements.csv'}, {args.out / 'tests.csv'}, {args.out / 'summary.md'}"
          + (f", {args.out / 'report.xlsx'}" if xlsx else ""))
    for line in untagged:
        print(f"warning: no requirement: {line}", file=sys.stderr)
    # Hundreds of tests have no description yet: one line for them all, unless asked.
    kind = "error" if args.require_steps else "warning"
    if undescribed and (args.verbose or args.require_steps):
        for line in undescribed:
            print(f"{kind}: no {line}", file=sys.stderr)
    elif undescribed:
        print(f"{kind}: {plural(len(undescribed), 'test')} with no description, steps or preconditions (--verbose lists them)",
              file=sys.stderr)
    for line in fixed:
        print(f"note: a known gap passes, {FIXED_NOTE}: {line}", file=sys.stderr)
    for line in unknown:
        print(f"error: unknown requirement: {line}", file=sys.stderr)
    for line in bad_ids:
        print(f"error: {line}", file=sys.stderr)
    if incomplete:
        print(f"error: {stopped}", file=sys.stderr)
    failed = args.fail_unless_gap and counts["fail"] > 0
    unready = args.require_steps and undescribed
    return 1 if unknown or bad_ids or incomplete or failed or unready else 0


if __name__ == "__main__":
    sys.exit(main())

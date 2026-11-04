#!/usr/bin/env python3
"""
The functional tests' two workbooks: the test specification (what is tested, and how) and the
test report (how one run went), from the same tests.

The tests come from two places:
  - the automated tests, read from the .bats files: their tags (`# bats test_tags=req:CONFIG-04,
    id:N0012` above a test, `# bats file_tags=eco:noos` for a file, or the ecosystem from its
    folder, noos/ or linux/, and `gap` for a known gap: a requirement the CLI doesn't meet yet)
    and their comments (`# Description:` and `# Steps:` above a test, `# Preconditions:` once
    per file, before its first test);
    A test tagged `e2e` (under e2e/) is an end-to-end test: one user's story across many
    commands, on the real trees; it needs no requirement, and run.sh runs it only when asked
    (run.sh e2e);
  - the manual and planned tests, in manual-tests.yaml: a manual test is done by a person
    (hardware, a look at the screen), a planned one is still to be automated. When it is, it
    moves into a .bats file with the same ID.
And the results from two: bats' JUnit (`--report-formatter junit`: pass, fail or skipped per
test), and manual-results.csv, where whoever runs a manual test records how it went.

A test's ID is N and 4 digits in noos, L and 4 digits in linux, C and 4 digits for a
conformity test (N0001, L0123, C0002), one sequence per prefix for every kind of test alike, unique, and never reused or renumbered: it
names the test in both workbooks whatever its file or name.

A test's status: pass, fail, skipped or not run for an automated test, and `gap` for a known gap
that fails: a known issue, not a failure, listed so it isn't forgotten (a known gap that passes
is a pass, noted "fixed: drop the gap tag"). A manual test's is its last recorded result (pass,
fail or blocked), or `manual` when none is recorded; a planned test's is `planned`. A
requirement's status in an ecosystem is the first of fail, gap, pass, skipped (or blocked),
manual, planned its tests have, and not tested when it has none.

The specification is versioned: the number in spec-version (raised by hand when the spec is
handed out), the last commit that changed a spec source and its date, and a fingerprint of the
spec's content, so that two copies of one number with different content can be told apart.
The report says when and how it was run (CI or local, by whom, on which commit) and which spec
version it ran.

It writes, in the output directory:
  - test-spec.xlsx    the specification: About (the version), Tests (ID, kind, ecosystem,
                      requirements, description, preconditions, steps), Coverage (each
                      requirement's automated, manual and planned tests); and test-spec.csv;
  - test-report.xlsx  the report: Run (when, how, what), Requirements (each one's status per
                      ecosystem, its tests and those failing), Tests (each test's status);
                      and tests.csv, requirements.csv;
  - summary.md        the run, the counts, and the requirements that fail, are known gaps or
                      aren't tested, in Markdown (a CI run's summary).
The workbooks need openpyxl, and manual-tests.yaml PyYAML; without openpyxl only the CSVs are
written. With --spec-only it writes the specification alone, and needs no test run.

It exits 1 when a test names a requirement that doesn't exist, so a renamed requirement can't
leave a stale test behind; when a test has no ID, a malformed one, one of the other ecosystem's
prefix, or one another test has; when manual-tests.yaml or manual-results.csv has an entry it
can't take; and when bats ran fewer tests than --expected (the count bats --count gives for the
same run): a run that stopped early, a full disk say, isn't a pass. With --fail-unless-gap it
also exits 1 when an automated test fails that isn't a known gap (CI: the known gaps don't fail
the run, and neither do manual results). A test with no requirement is only listed. Every test
must have a description and steps, and every file preconditions: a test missing one is only
counted (listed with --verbose), and an error with --require-steps.

    report.py --junit out/report.xml --tests test/functional --requirements docs/requirements.csv --out out noos linux
    report.py --spec-only --tests test/functional --requirements docs/requirements.csv --out out
"""

import argparse
import csv
import datetime
import hashlib
import json
import os
import pathlib
import platform
import re
import socket
import subprocess
import sys
import xml.etree.ElementTree as ElementTree

ECOSYSTEMS = ["linux", "noos"]
# The Ecosystems column of the requirements, as the ecosystems a requirement applies to.
APPLIES = {"All": ECOSYSTEMS, "Linux": ["linux"], "CAPI": ["noos"]}
GAP_TAG = "gap"
KINDS = ("automated", "e2e", "conformity", "manual", "planned")
E2E_TAG = "e2e"
# A conformity test (conformity/, tagged conformity, ecosystem `all`) runs the same case on both
# backends and checks they answer alike; its status counts for both ecosystems.
CONFORMITY_TAG, BOTH = "conformity", "all"
MANUAL_RESULTS = ("pass", "fail", "blocked")
# A requirement's status from its tests', the first of these they have.
PRECEDENCE = ("fail", "gap", "pass", "skipped", "blocked", "manual", "planned")
# The spec's own files, next to report.py.
MANUAL_TESTS, MANUAL_RESULTS_FILE, SPEC_VERSION = "manual-tests.yaml", "manual-results.csv", "spec-version"
# The workbook columns whose text wraps, and their widths (in characters).
WIDE = {"Description": 50, "Preconditions": 40, "Steps": 70, "Test IDs": 30, "Failing/gap IDs": 20,
        "Automated": 30, "End to end": 20, "Conformity": 20, "Manual": 20, "Planned": 20, "Message": 50, "Value": 70}
FIXED_NOTE = "fixed: drop the gap tag"

TAGS_LINE = re.compile(r"^\s*#\s*bats\s+(test_tags|file_tags)\s*=\s*(.*)$")
TEST_LINE = re.compile(r"^\s*@test\s+(['\"])(.*)\1\s*\{")
# A test's ID: its ecosystem's prefix and 4 digits.
ID_LINE = re.compile(r"^[NLC][0-9]{4}$")
ID_PREFIX = {"noos": "N", "linux": "L", BOTH: "C"}
# The comments a test or a file is described with: `# Description: text`, `# Steps:` then
# `#   1. text` per step, `# Preconditions: text`. A field runs on over the comment lines
# after it, up to the next field, another note (`# Gap: ...`, one word and a colon), the tags
# line, or a line that isn't a comment.
COMMENT_LINE = re.compile(r"^\s*#(?:\s(.*))?$")
FIELD_LINE = re.compile(r"^(Description|Steps|Preconditions):\s*(.*)$")
NOTE_LINE = re.compile(r"^[A-Z][\w-]*:(\s|$)")
STEP_LINE = re.compile(r"^\s*([0-9]+)\.\s+(.*)$")
DATE_LINE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def split_tags(text):
    return [tag.strip() for tag in text.split(",") if tag.strip()]


def add_text(text, more):
    """A field's text with a continuation line joined on with a space."""
    return f"{text} {more}" if text and more else text or more


def read_tests(root):
    """Every automated test of the .bats files under root, as a test (see `new_test`), keyed
    by (relative file, name). steps is a list, "1. text" per step, as numbered in the file."""
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
                # The name as bats reports it: a double-quoted name has its shell escapes undone.
                name = test.group(2)
                if test.group(1) == '"':
                    name = re.sub(r'\\([$`"\\])', r"\1", name)
                tests[(relative, name)] = new_test(
                    next((tag for tag in (E2E_TAG, CONFORMITY_TAG) if tag in all_tags), "automated"), relative, name, eco, " ".join(tag[3:] for tag in all_tags if tag.startswith("id:")),
                    [tag[4:] for tag in all_tags if tag.startswith("req:")], fields["Description"], fields["Steps"],
                    gap=GAP_TAG in all_tags)
                fields = {"Description": "", "Steps": []}
        # The file's preconditions apply to all its tests, wherever they were written.
        for (test_file_name, _), test in tests.items():
            if test_file_name == relative:
                test["preconditions"] = preconditions
    return tests


def new_test(kind, file, name, eco, test_id, reqs, description, steps, preconditions="", gap=False):
    """A test of the specification, whatever its source: kind (automated, e2e, manual, planned), the
    file it is in, its name, ecosystem, ID, requirements, description, steps, preconditions, and
    whether it is a known gap."""
    return {"kind": kind, "file": file, "name": name, "eco": eco, "id": test_id, "reqs": reqs, "description": description,
            "steps": steps, "preconditions": preconditions, "gap": gap}


def read_manual_tests(path):
    """The manual and planned tests of manual-tests.yaml, keyed like read_tests' by (file,
    name), and what is wrong with its entries. Each entry: id, kind (manual or planned),
    ecosystem, requirements, title, description, preconditions, steps (a list)."""
    if not path.exists():
        return {}, []
    try:
        import yaml
    except ImportError:
        return {}, [f"{path.name} needs PyYAML (pip install pyyaml)"]
    try:
        entries = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    except yaml.YAMLError as error:
        return {}, [f"{path.name} doesn't parse: {error}"]
    if not isinstance(entries, list):
        return {}, [f"{path.name} is not a list of tests"]
    tests, errors = {}, []
    for index, entry in enumerate(entries, start=1):
        where = f"{path.name}, entry {index}" + (f" ({entry.get('id')})" if isinstance(entry, dict) and entry.get("id") else "")
        if not isinstance(entry, dict):
            errors.append(f"{where}: not a mapping")
            continue
        unknown = sorted(set(entry) - {"id", "kind", "ecosystem", "requirements", "title", "description", "preconditions", "steps"})
        problems = [f"unknown field {key}" for key in unknown]
        if entry.get("kind") not in ("manual", "planned"):
            problems.append("kind is manual or planned")
        if entry.get("ecosystem") not in ECOSYSTEMS:
            problems.append(f"ecosystem is {' or '.join(ECOSYSTEMS)}")
        for key in ("title", "description", "preconditions"):
            if not isinstance(entry.get(key), str) or not entry[key].strip():
                problems.append(f"{key} is a text")
        steps, reqs = entry.get("steps"), entry.get("requirements", [])
        if not isinstance(steps, list) or not steps or not all(isinstance(step, str) and step.strip() for step in steps):
            problems.append("steps is a list of texts")
        if not isinstance(reqs, list) or not all(isinstance(req, str) for req in reqs):
            problems.append("requirements is a list of requirement IDs")
        if problems:
            errors.append(f"{where}: {'; '.join(problems)}")
            continue
        name = " ".join(entry["title"].split())
        tests[(path.name, name)] = new_test(
            entry["kind"], path.name, name, entry["ecosystem"], str(entry.get("id") or ""), reqs,
            " ".join(entry["description"].split()), [f"{number}. {' '.join(step.split())}" for number, step in enumerate(steps, start=1)],
            " ".join(entry["preconditions"].split()))
    return tests, errors


def read_manual_results(path, tests):
    """manual-results.csv: the last recorded result of each manual test, {ID: row}, and what is
    wrong with its rows. Columns: ID, Date (YYYY-MM-DD), Tester, Result (pass, fail or
    blocked), Commit, Notes; the latest date wins, and a later row the same day."""
    if not path.exists():
        return {}, []
    manual = {test["id"] for test in tests.values() if test["kind"] == "manual"}
    latest, errors = {}, []
    with open(path, newline="", encoding="utf-8") as handle:
        for number, row in enumerate(csv.DictReader(handle), start=2):
            where = f"{path.name}, line {number}"
            test_id, date, result = (row.get("ID") or "").strip(), (row.get("Date") or "").strip(), (row.get("Result") or "").strip()
            if test_id not in manual:
                errors.append(f"{where}: {test_id or 'no ID'} is not a manual test of {MANUAL_TESTS}")
            elif not DATE_LINE.match(date):
                errors.append(f"{where}: Date is YYYY-MM-DD, got {date!r}")
            elif result not in MANUAL_RESULTS:
                errors.append(f"{where}: Result is {', '.join(MANUAL_RESULTS)}, got {result!r}")
            elif test_id not in latest or date >= latest[test_id]["Date"]:
                latest[test_id] = {key: (value or "").strip() for key, value in row.items() if key}
    return latest, errors


def id_errors(tests):
    """What is wrong with the tests' IDs: a test with none (or several), a malformed one, one
    of the other ecosystem's prefix, or one two tests have, in any of the sources."""
    errors, seen = [], {}
    for (file, name), test in tests.items():
        test_id = test["id"]
        if not test_id:
            errors.append(f"no id: {file}: {name}")
        elif not ID_LINE.match(test_id):
            errors.append(f"malformed id {test_id} (N, L or C and 4 digits): {file}: {name}")
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
    """An automated test's status in the report: a known gap that fails is `gap`, not a failure."""
    return "gap" if gap and raw == "fail" else raw


def combined(statuses):
    """One status for a requirement in an ecosystem, from its tests' statuses."""
    return next((status for status in PRECEDENCE if status in statuses), "not tested")


def git(root, *words):
    """A git command's output in root, "" when git or the repository isn't there."""
    try:
        return subprocess.run(["git", *words], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def spec_version(root, spec_rows):
    """The specification's version: {number, commit, date, fingerprint, text}. number from
    spec-version, commit and date of the last commit that changed a spec source, fingerprint
    the first 12 hex digits of a SHA-256 of the spec's content."""
    number = "unversioned"
    path = root / SPEC_VERSION
    if path.exists():
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
        number = lines[0] if lines else number
    last = git(root, "log", "-1", "--format=%h %cs", "--", "*.bats", MANUAL_TESTS, SPEC_VERSION).split()
    commit, date = (last + ["", ""])[:2]
    fingerprint = hashlib.sha256(json.dumps(sorted(spec_rows), ensure_ascii=False).encode()).hexdigest()[:12]
    text = f"{number} ({commit} {date}, {fingerprint})" if commit else f"{number} ({fingerprint})"
    return {"number": number, "commit": commit, "date": date, "fingerprint": fingerprint, "text": text}


def run_info(root, args, started, finished):
    """When and how the run was made: [(field, value)], CI's run or the local user, the commit."""
    environment = os.environ
    ci = environment.get("GITHUB_ACTIONS") == "true"
    rows = [("Started", started), ("Finished", finished)]
    try:
        seconds = (datetime.datetime.fromisoformat(finished) - datetime.datetime.fromisoformat(started)).total_seconds()
        rows.append(("Duration", f"{seconds:.0f} s"))
    except ValueError:
        pass
    if ci:
        url = f"{environment.get('GITHUB_SERVER_URL', '')}/{environment.get('GITHUB_REPOSITORY', '')}/actions/runs/{environment.get('GITHUB_RUN_ID', '')}"
        rows += [("Run by", "CI (GitHub Actions)"), ("CI run", url),
                 ("Workflow", f"{environment.get('GITHUB_WORKFLOW', '')}, run {environment.get('GITHUB_RUN_NUMBER', '')}"),
                 ("Event", environment.get("GITHUB_EVENT_NAME", "")), ("Triggered by", environment.get("GITHUB_ACTOR", ""))]
        branch = environment.get("GITHUB_HEAD_REF") or environment.get("GITHUB_REF_NAME", "")
    else:
        user = git(root, "config", "user.name") or environment.get("USER", "")
        rows += [("Run by", f"local ({user})"), ("Host", socket.gethostname())]
        branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    changed = git(root, "status", "--porcelain", "--untracked-files=no")
    rows += [("Commit", git(root, "rev-parse", "--short", "HEAD") + (" (with uncommitted changes)" if changed else "")),
             ("Branch", branch), ("CLI version", args.cli_version or ""), ("Node", args.node_version or ""),
             ("OS", platform.platform()), ("Command", args.command or ""),
             ("Real CAPI trees", "yes" if environment.get("AA_CAPI_PATH") and environment.get("AA_MODULE_PATHS") else "no (the build tests skip)"),
             ("Target", environment.get("AA_TARGET", "")), ("Flashing a board", "yes" if environment.get("AA_DEPLOY") == "1" else "no")]
    return rows


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def plural(count, word):
    return f"{count} {word}" + ("" if count == 1 else "s")


def write_summary(path, run, counts, requirement_rows, ids_by_status, notes):
    """summary.md: the run, the counts, per ecosystem too, then the requirements a reader should
    look at: those failing, with the IDs of their failing tests, those with a known gap, with
    the IDs of those, and those no ecosystem they apply to tests yet. ids_by_status:
    {requirement: {status: [test ID]}}."""
    lines = ["## Functional tests", "", *(f"- {field}: {value}" for field, value in run if value), "",
             f"Tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped"
             + f"; manual: {counts['manual pass']} passed, {counts['manual fail']} failed, {counts['manual']} to run; "
             + f"{counts['planned']} planned", ""]
    lines += ["| Ecosystem | Requirements | Tested | Pass | Fail | Known gaps | Skipped | Manual only | Planned only |",
              "|---|---|---|---|---|---|---|---|---|"]
    for index, eco in enumerate(ECOSYSTEMS):
        column = [row[5 + index] for row in requirement_rows if row[5 + index] != "-"]
        tested = sum(1 for status in column if status not in ("not tested", "manual", "planned"))
        lines.append(f"| {eco} | {len(column)} | {tested} | {column.count('pass')} | {column.count('fail')} | {column.count('gap')} | "
                     f"{column.count('skipped') + column.count('blocked')} | {column.count('manual')} | {column.count('planned')} |")
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
    fills = {"pass": "d1fae5", "fail": "fee2e2", "gap": "fed7aa", "skipped": "fef9c3", "blocked": "fef9c3",
             "manual": "e0e7ff", "planned": "ede9fe", "not tested": "f3f4f6"}
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
            elif name in ("Field", "Spec version"):
                sheet.column_dimensions[get_column_letter(index + 1)].width = 22
        sheet.freeze_panes = "B2"
        sheet.auto_filter.ref = sheet.dimensions
    workbook.save(path)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--junit", type=pathlib.Path, help="bats' JUnit results (not with --spec-only)")
    parser.add_argument("--tests", required=True, type=pathlib.Path, help="the folder of the .bats files and the spec's own files")
    parser.add_argument("--requirements", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--spec-only", action="store_true", help="write the specification alone, with no test run")
    parser.add_argument("--fail-unless-gap", action="store_true", help="exit 1 when an automated test fails that isn't a known gap")
    parser.add_argument("--expected", type=int, help="how many tests bats was to run; exit 1 when it ran fewer")
    parser.add_argument("--require-steps", action="store_true", help="exit 1 when a test has no description, steps or preconditions")
    parser.add_argument("--verbose", action="store_true", help="list each test with no description, steps or preconditions")
    parser.add_argument("--started", help="when the run started (ISO 8601); now when not given")
    parser.add_argument("--command", help="how the run was asked for, for the report's Run sheet")
    parser.add_argument("--cli-version", help="the CLI's version (analog-attach --version)")
    parser.add_argument("--node-version", help="node's version")
    parser.add_argument("targets", nargs="*", type=pathlib.Path, help="the files and folders bats ran, relative to --tests")
    args = parser.parse_args()
    if not args.spec_only and args.junit is None:
        parser.error("--junit is needed, unless --spec-only")

    with open(args.requirements, encoding="utf-8") as handle:
        requirements = list(csv.DictReader(handle))
    known = {row["ID"] for row in requirements}
    tests = read_tests(args.tests)
    manual_tests, source_errors = read_manual_tests(args.tests / MANUAL_TESTS)
    tests.update(manual_tests)
    manual_results, result_errors = read_manual_results(args.tests / MANUAL_RESULTS_FILE, tests)
    source_errors += result_errors
    bad_ids = id_errors(tests)

    unknown, untagged, undescribed = [], [], []
    for (file, name), test in tests.items():
        # An end-to-end test needs no requirement: it follows a user's story across many.
        if not test["reqs"] and test["kind"] != E2E_TAG:
            untagged.append(f"{file}: {name}")
        missing = [what for what, text in (("description", test["description"]), ("steps", test["steps"]),
                                           ("preconditions", test["preconditions"])) if not text]
        if missing:
            undescribed.append(f"{', no '.join(missing)}: {test['id'] or '-'} {file}: {name}")
        unknown += [f"{file}: {name}: {req}" for req in test["reqs"] if req not in known]

    # The specification: every test, by ID, and each requirement's tests by kind.
    ordered = sorted(tests.values(), key=lambda test: (test["id"] or "~", test["file"], test["name"]))
    spec_header = ["ID", "Kind", "Ecosystem", "Requirements", "Test", "File", "Description", "Preconditions", "Steps"]
    spec_rows = [[test["id"], test["kind"], test["eco"], " ".join(test["reqs"]), test["name"], test["file"], test["description"],
                  test["preconditions"], "\n".join(test["steps"])] for test in ordered]
    version = spec_version(args.tests, spec_rows)
    by_kind = {}  # requirement -> {kind: [test ID]}
    for test in ordered:
        for req in test["reqs"]:
            by_kind.setdefault(req, {}).setdefault(test["kind"], []).append(test["id"])
    coverage_header = ["ID", "Command", "Name", "Ecosystems", "Automated", "End to end", "Conformity", "Manual", "Planned"]
    coverage_rows = [[row["ID"], row["Command"], row["Name"], row["Ecosystems"],
                      *(" ".join(by_kind.get(row["ID"], {}).get(kind, [])) for kind in KINDS)] for row in requirements]
    kind_counts = {kind: sum(1 for test in ordered if test["kind"] == kind) for kind in KINDS}
    about = [("Spec version", version["number"]), ("Last changed", f"{version['commit']} {version['date']}".strip()),
             ("Fingerprint", version["fingerprint"]),
             ("Tests", f"{len(ordered)}: {kind_counts['automated']} automated, {kind_counts['e2e']} end to end, {kind_counts['conformity']} conformity, "
                       f"{kind_counts['manual']} manual, {kind_counts['planned']} planned"),
             ("Generated", datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"))]
    args.out.mkdir(parents=True, exist_ok=True)
    write_csv(args.out / "test-spec.csv", spec_header, spec_rows)
    spec_xlsx = write_xlsx(args.out / "test-spec.xlsx", [("About", ["Field", "Value"], about), ("Tests", spec_header, spec_rows),
                                                         ("Coverage", coverage_header, coverage_rows)])
    errors = [f"unknown requirement: {line}" for line in unknown] + bad_ids + source_errors

    if args.spec_only:
        print(f"spec {version['text']}: {about[3][1]}")
        print(f"spec: {args.out / 'test-spec.csv'}" + (f", {args.out / 'test-spec.xlsx'}" if spec_xlsx else ""))
        return finish(errors, untagged, undescribed, [], args, failed=False)

    targets = [target if target.is_absolute() else args.tests / target for target in args.targets]
    results = read_results(args.junit, args.tests, targets) if args.junit.exists() else {}
    test_rows = []
    by_requirement = {}  # (id, eco) -> [status]
    ids_by_status = {}  # requirement -> {status: [test ID]}
    ran = {}  # requirement -> how many of its tests ran (once each, a conformity test too)
    fixed = []
    for test in ordered:
        note, seconds, date, tester = "", "", "", ""
        if test["kind"] in ("automated", E2E_TAG, CONFORMITY_TAG):
            raw, message, seconds = results.get((test["file"], test["name"]), ("not run", "", ""))
            status = test_status(raw, test["gap"])
            note = message.splitlines()[0] if message else ""
            if test["gap"] and raw == "pass":
                note = FIXED_NOTE
                fixed.append(f"{test['file']}: {test['name']}")
        elif test["kind"] == "manual":
            result = manual_results.get(test["id"])
            status = result["Result"] if result else "manual"
            if result:
                date, tester, note = result.get("Date", ""), result.get("Tester", ""), result.get("Notes", "")
                if result.get("Commit"):
                    note = f"{note} (on {result['Commit']})".strip()
        else:
            status = "planned"
        test_rows.append([test["id"], test["kind"], test["file"], test["name"], test["eco"], " ".join(test["reqs"]), status,
                          "yes" if test["gap"] else "", seconds, date, tester, note])
        for req in test["reqs"]:
            ids_by_status.setdefault(req, {}).setdefault("all", []).append(test["id"])
            ids_by_status[req].setdefault(status, []).append(test["id"])
            if status != "not run":
                for eco in (ECOSYSTEMS if test["eco"] == BOTH else [test["eco"]]):
                    by_requirement.setdefault((req, eco), []).append(status)
                if status not in ("manual", "planned"):
                    ran[req] = ran.get(req, 0) + 1

    requirement_rows = []
    for row in requirements:
        applies = APPLIES.get(row["Ecosystems"], ECOSYSTEMS)
        statuses = [combined(by_requirement.get((row["ID"], eco), [])) if eco in applies else "-" for eco in ECOSYSTEMS]
        count = ran.get(row["ID"], 0)
        ids = ids_by_status.setdefault(row["ID"], {})
        failing = ids.get("fail", []) + ids.get("gap", [])
        requirement_rows.append([row["ID"], row["Command"], row["Name"], row["Ecosystems"], row["Basis"], *statuses, count,
                                 " ".join(ids.get("all", [])), " ".join(failing)])

    started = args.started or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    finished = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    run = run_info(args.tests, args, started, finished) + [("Spec version", version["text"])]
    test_header = ["ID", "Kind", "File", "Test", "Ecosystem", "Requirements", "Status", "Known gap", "Seconds", "Date", "Tester", "Message"]
    requirement_header = ["ID", "Command", "Name", "Ecosystems", "Basis", *ECOSYSTEMS, "Tests", "Test IDs", "Failing/gap IDs"]
    write_csv(args.out / "tests.csv", test_header, test_rows)
    write_csv(args.out / "requirements.csv", requirement_header, requirement_rows)
    report_xlsx = write_xlsx(args.out / "test-report.xlsx", [("Run", ["Field", "Value"], run),
                                                             ("Requirements", requirement_header, requirement_rows),
                                                             ("Tests", test_header, test_rows)])

    statuses = [(row[1], row[6]) for row in test_rows]
    automated = [status for kind, status in statuses if kind in ("automated", E2E_TAG, CONFORMITY_TAG)]
    counts = {status: automated.count(status) for status in ("pass", "fail", "gap", "skipped", "not run")}
    counts.update({"manual pass": statuses.count(("manual", "pass")), "manual fail": statuses.count(("manual", "fail")),
                   "manual": statuses.count(("manual", "manual")), "planned": statuses.count(("planned", "planned"))})
    applicable = [status for row in requirement_rows for status in row[5:7] if status != "-"]
    tested = sum(1 for row in requirement_rows if any(status not in ("-", "not tested", "manual", "planned") for status in row[5:7]))
    # bats stopping early leaves the tests it didn't get to out of the JUnit, as if filtered out.
    if args.expected is not None and len(results) < args.expected:
        errors.insert(0, f"bats ran {len(results)} of the {args.expected} tests it was to run: the run stopped early")
    notes = [f"error: {line}" for line in errors] + [f"{FIXED_NOTE}: {line}" for line in fixed]
    write_summary(args.out / "summary.md", run, counts, requirement_rows, ids_by_status, notes)

    print(f"tests: {counts['pass']} passed, {counts['fail']} failed, {plural(counts['gap'], 'known gap')}, {counts['skipped']} skipped"
          + (f", {counts['not run']} not run" if counts["not run"] else "")
          + (f"; manual: {counts['manual pass']} passed, {counts['manual fail']} failed, {counts['manual']} to run" if kind_counts["manual"] else "")
          + (f"; {counts['planned']} planned" if counts["planned"] else ""))
    print(f"requirements: {tested} of {len(requirement_rows)} tested ({applicable.count('pass')} pass, {applicable.count('fail')} fail, "
          f"{plural(applicable.count('gap'), 'known gap')}, {applicable.count('skipped')} skipped per ecosystem)")
    print(f"spec {version['text']}: {args.out / 'test-spec.csv'}" + (f", {args.out / 'test-spec.xlsx'}" if spec_xlsx else ""))
    print(f"report: {args.out / 'requirements.csv'}, {args.out / 'tests.csv'}, {args.out / 'summary.md'}"
          + (f", {args.out / 'test-report.xlsx'}" if report_xlsx else ""))
    return finish(errors, untagged, undescribed, fixed, args, failed=args.fail_unless_gap and counts["fail"] > 0)


def finish(errors, untagged, undescribed, fixed, args, failed):
    """Print the warnings and errors, and the exit status: 1 on an error, a missing description
    with --require-steps, or a failed test when `failed`."""
    for line in untagged:
        print(f"warning: no requirement: {line}", file=sys.stderr)
    # One line for the tests missing a description, unless asked for them all.
    kind = "error" if args.require_steps else "warning"
    if undescribed and (args.verbose or args.require_steps):
        for line in undescribed:
            print(f"{kind}: no {line}", file=sys.stderr)
    elif undescribed:
        print(f"{kind}: {plural(len(undescribed), 'test')} with no description, steps or preconditions (--verbose lists them)",
              file=sys.stderr)
    for line in fixed:
        print(f"note: a known gap passes, {FIXED_NOTE}: {line}", file=sys.stderr)
    for line in errors:
        print(f"error: {line}", file=sys.stderr)
    return 1 if errors or failed or (args.require_steps and undescribed) else 0


if __name__ == "__main__":
    sys.exit(main())

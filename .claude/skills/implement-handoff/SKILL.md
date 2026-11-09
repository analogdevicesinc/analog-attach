---
name: implement-handoff
description: Implement a docs/*-handoff.md fix plan one item at a time, verifying each, without committing.
---

Given a handoff doc as the argument:

1. Read it and list the open items.
2. For each item, in order: explain the issue and the planned fix, then WAIT for my confirmation. One item at a time; never start the next.
3. Write a failing test first, then implement. Touch only the files the item names.
4. If attach-lib changed, run `yarn workspace attach-lib build` before any CLI test or snapshot.
5. From the repo root, run the verify of the side the item changed (*Definition of done* in `packages/cli/CLAUDE.md`): `yarn verify:linux` for attach-lib or the CLI's Linux backend, `yarn verify:no-os` for attach-no-os-lib or the CLI's noos backend, and the full `yarn verify` only for a common change or both sides. Never run the other side's builds or tests. All of it must pass; fix any lint or type error you see, and say which verify ran.
6. Update the item's **Status** in the doc to `resolved`, with the root cause, files changed and tests added.
7. Never commit, amend or rewrite history. Suggest a commit message (prefixed `cli:` or `attach-lib:`) and wait.

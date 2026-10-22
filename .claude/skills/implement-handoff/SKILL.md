---
name: implement-handoff
description: Implement a docs/*-handoff.md fix plan one item at a time, verifying each, without committing.
---

Given a handoff doc as the argument:

1. Read it and list the open items.
2. For each item, in order: explain the issue and the planned fix, then WAIT for my confirmation. One item at a time; never start the next.
3. Write a failing test first, then implement. Touch only the files the item names.
4. If attach-lib changed, run `yarn workspace attach-lib build` before any CLI test or snapshot.
5. Run `yarn verify` from the repo root. All of it must pass; fix any lint or type error you see.
6. Update the item's **Status** in the doc to `resolved`, with the root cause, files changed and tests added.
7. Never commit, amend or rewrite history. Suggest a commit message (prefixed `attach-cli:` or `attach-lib:`) and wait.

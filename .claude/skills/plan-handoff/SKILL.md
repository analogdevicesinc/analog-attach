---
name: plan-handoff
description: Turn the open findings of a code review (or one tier of them) into a docs/<name>-handoff.md that a fresh session can implement. Plans only, changes no code.
---

Given a review doc or tier name as the argument:

1. Read the review doc and list the unresolved items. Don't implement anything.
2. Write `docs/<tier>-fix-handoff.md`, one section per item, in this template:
   - **ID** and title
   - **Repro**: a command saved under `scripts/repros/` (never `/tmp`), with the expected and actual output
   - **Root cause** with `file:line`
   - **Proposed fix**; if the plan leaves a design choice open, list the options with trade-offs instead of picking
   - **Tests to add**
   - **Status**: `open`
3. Group items by the files they touch so they can run in parallel with disjoint file ownership.
4. Show me the doc and wait. Don't commit.

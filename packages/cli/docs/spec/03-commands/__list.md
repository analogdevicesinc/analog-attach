# __list (withdrawn)

The hidden `__list <kind> [<arg>...]` command is gone: `analog-attach
__list parent` is an unknown command (GRM-004). Shell completion asks the
backend for its candidates in the same process (`05-completion.md`), and
`list property`, `list value` and `list parent` compute their answers
themselves (`list.md`).

The requirements of this chapter are *withdrawn*: INTLIST-001, INTLIST-002,
INTLIST-003, INTLIST-004, INTLIST-010, INTLIST-011, INTLIST-012,
INTLIST-030, INTLIST-050, INTLIST-051, INTLIST-052, INTLIST-053,
INTLIST-070 and INTLIST-071. The node lookup of INTLIST-012 is now
`05-completion.md` COMPL-054.

Its open issues are closed with it: IL-1 and IL-2 have no command left to
apply to, and IL-3 moved to `05-completion.md` (CO-12).

---
id: add-calc
title: "Add calc() combining add and mul, with test"
intent: toy-math
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [add-add, add-mul]
delivers: [SC-1]
created: 2026-11-13T00:00:00Z
---

# Work Item: Add calc() combining add and mul, with test

## Description

Gives the library `calc(a, b)`, which is add(a, b) * mul(a, b). `lib/calc.js` requires `./add` and `./mul` and reimplements neither.

## Acceptance Criteria

- [ ] `tests/calc.test.js` shows calc(2, 3) is 30.
- [ ] `lib/calc.js` requires `./add` and `./mul`.

## Edge Cases

None.

## Out of Scope

None.

## Test Plan

- Adds: `tests/calc.test.js` :: calc(2, 3) is 30
- Integration with add-add: `tests/calc.test.js` :: calc(2, 3) is 30 through the real add()
- Integration with add-mul: `tests/calc.test.js` :: calc(2, 3) is 30 through the real mul()
- Breaks: none

## Reuse

None.

## Execution Manifest

context:
  required:
    - path: lib/add.js
      reason: the add() this item calls
    - path: lib/mul.js
      reason: the mul() this item calls
  patterns:
    - path: tests/add.test.js
      reason: the test style to follow
  tests:
    - path: tests/calc.test.js
      reason: the test this item adds
ownership:
  editable:
    - lib/calc.js
    - tests/calc.test.js

## Technical Notes

(none)

## Dependencies

- add-add
- add-mul

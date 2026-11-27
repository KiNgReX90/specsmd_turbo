---
id: add-add
title: "Add add() module with test"
intent: toy-math
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
delivers: [SC-1]
created: 2026-11-13T00:00:00Z
---

# Work Item: Add add() module with test

## Description

Gives the library its `add(a, b)`, which `calc()` builds on. `lib/add.js` exports it as `module.exports = { add }`.

## Acceptance Criteria

- [ ] `tests/add.test.js` shows add(2, 3) is 5 and add(-1, 1) is 0.

## Edge Cases

None.

## Out of Scope

None.

## Test Plan

- Adds: `tests/add.test.js` :: add(2, 3) is 5 and add(-1, 1) is 0
- Integration: none
- Breaks: none

## Reuse

None.

## Execution Manifest

context:
  required:
    - path: package.json
      reason: the test script
  patterns:
    - path: package.json
      reason: CommonJS, tests under tests/ with node:test
  tests:
    - path: tests/add.test.js
      reason: the test this item adds
ownership:
  editable:
    - lib/add.js
    - tests/add.test.js

## Technical Notes

(none)

## Dependencies

(none)

---
id: add-mul
title: "Add mul() module with test"
intent: toy-math
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: []
delivers: [SC-1]
created: 2026-11-13T00:00:00Z
---

# Work Item: Add mul() module with test

## Description

Gives the library its `mul(a, b)`, which `calc()` builds on. `lib/mul.js` exports it as `module.exports = { mul }`.

## Acceptance Criteria

- [ ] `tests/mul.test.js` shows mul(2, 3) is 6 and mul(-1, 1) is -1.

## Edge Cases

None.

## Out of Scope

None.

## Test Plan

- Adds: `tests/mul.test.js` :: mul(2, 3) is 6 and mul(-1, 1) is -1
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
    - path: tests/mul.test.js
      reason: the test this item adds
ownership:
  editable:
    - lib/mul.js
    - tests/mul.test.js

## Technical Notes

(none)

## Dependencies

(none)

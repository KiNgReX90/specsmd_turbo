---
id: toy-math
title: "Add a tiny math library"
status: pending
created: 2026-11-13T00:00:00Z
---

# Intent: Add a tiny math library

## Goal

A `lib/` with `add.js`, `mul.js` and `calc.js`, where calc(a, b) is add(a, b) * mul(a, b), each with a passing `node:test` file under `tests/`.

## Success Criteria

- SC-1: `npm test` passes with the three test files `tests/add.test.js`, `tests/mul.test.js` and `tests/calc.test.js`.

## Item Map

| Criterion | Items |
| --- | --- |
| SC-1 | add-add, add-mul, add-calc |

## Constraints

- CommonJS exports, no dependencies.

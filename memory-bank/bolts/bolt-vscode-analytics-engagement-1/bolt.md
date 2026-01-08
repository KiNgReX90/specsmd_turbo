---
id: bolt-vscode-analytics-engagement-1
unit: 003-engagement-events
intent: 012-vscode-extension-analytics
type: simple-construction-bolt
status: planned
stories:
  - 001-track-tab-navigation
  - 002-track-bolt-actions
  - 003-track-artifact-opened
  - 004-track-filter-changes
created: 2025-01-08T12:50:00Z
started: null
completed: null
current_stage: null
stages_completed: []

requires_bolts:
  - bolt-vscode-analytics-core-1
enables_bolts: []
requires_units: []
blocks: false

complexity:
  avg_complexity: 1
  avg_uncertainty: 1
  max_dependencies: 1
  testing_scope: 1
---

# Bolt: bolt-vscode-analytics-engagement-1

## Overview

Implement engagement tracking for user interactions with the explorer view including tab navigation, bolt actions, artifact access, and filter usage.

## Objective

Add tracking calls to SpecsmdWebviewProvider message handlers to capture user engagement patterns.

## Stories Included

- **001-track-tab-navigation**: Track tab switches with from/to (Should)
- **002-track-bolt-actions**: Track start, continue, view, open actions (Should)
- **003-track-artifact-opened**: Track artifact file opens by type (Should)
- **004-track-filter-changes**: Track filter usage (Should)

## Bolt Type

**Type**: Simple Construction Bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. plan**: Map message handler integration points
- [ ] **2. implement**: Add tracking calls to _handleMessage
- [ ] **3. test**: Test events with mock webview messages
- [ ] **4. integrate**: Verify no UI lag from tracking

## Dependencies

### Requires
- bolt-vscode-analytics-core-1 (tracker module)

### Enables
- None (leaf bolt)

## Success Criteria

- [ ] Tab changes tracked with from/to
- [ ] Bolt actions tracked with type and status
- [ ] Artifact opens tracked by type
- [ ] Filter changes tracked
- [ ] No UI blocking
- [ ] No sensitive data in events

## Notes

All integration in `SpecsmdWebviewProvider._handleMessage()`. Simple additions to existing switch cases.

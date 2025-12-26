---
id: bolt-sidebar-provider-4
unit: sidebar-provider
intent: 011-vscode-extension
type: simple-construction-bolt
status: planned
stories:
  - 008-current-focus-card
  - 009-up-next-queue
  - 010-activity-feed-ui
created: 2025-12-26T10:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

requires_bolts:
  - bolt-sidebar-provider-3
  - bolt-artifact-parser-2
enables_bolts: []
requires_units: []
blocks: false

complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: bolt-sidebar-provider-4

## Overview

Fourth sidebar-provider bolt that implements the detailed UI components for the command center: focus card, queue, and activity feed.

## Objective

Implement the Current Focus card with progress visualization, Up Next queue with dependency ordering, and Activity feed with filtering and resize.

## Stories Included

- **008-current-focus-card**: Expandable card with progress ring and stage pipeline (Must)
- **009-up-next-queue**: Dependency-ordered queue with blocked indicators (Must)
- **010-activity-feed-ui**: Activity feed with filter and resize (Must)

## Bolt Type

**Type**: Simple Construction Bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. Spec**: Pending → implementation-plan.md
- [ ] **2. Implement**: Pending → implementation-walkthrough.md
- [ ] **3. Test**: Pending → test-walkthrough.md

## Dependencies

### Requires
- bolt-sidebar-provider-3 (webview architecture in place)
- bolt-artifact-parser-2 (dependency and activity data)

### Enables
- bolt-extension-core-1 (final integration)

## Success Criteria

- [ ] Focus card displays active bolt with progress ring
- [ ] Stage pipeline shows correct status indicators
- [ ] Stories checklist with completion status
- [ ] Queue shows dependency-ordered pending bolts
- [ ] Blocked bolts show lock icon and blocker names
- [ ] Activity feed displays events with icons and times
- [ ] Activity filter works (All/Stages/Bolts)
- [ ] Activity section resizable with drag handle
- [ ] Activity height persists

## Notes

- **Design Reference**: `vs-code-extension/design-mockups/variation-8-2.html`
- Progress ring: SVG with stroke-dasharray
- Resize: mousedown/mousemove/mouseup events
- Relative time formatting: Xm ago, Xh ago, etc.

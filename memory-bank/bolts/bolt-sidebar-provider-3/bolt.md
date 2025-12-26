---
id: bolt-sidebar-provider-3
unit: sidebar-provider
intent: 011-vscode-extension
type: simple-construction-bolt
status: planned
stories:
  - 006-webview-tab-architecture
  - 007-command-center-bolts-tab
created: 2025-12-26T10:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

requires_bolts:
  - bolt-sidebar-provider-2
  - bolt-artifact-parser-2
enables_bolts:
  - bolt-sidebar-provider-4
requires_units: []
blocks: false

complexity:
  avg_complexity: 3
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: bolt-sidebar-provider-3

## Overview

Third sidebar-provider bolt that transitions from TreeDataProvider to WebviewViewProvider with tabbed architecture and implements the command center layout.

## Objective

Implement WebviewViewProvider with three tabs (Bolts, Specs, Overview) and the command center layout for the Bolts tab.

## Stories Included

- **006-webview-tab-architecture**: Tab system with persistence (Must)
- **007-command-center-bolts-tab**: Bolts tab layout with sections (Must)

## Bolt Type

**Type**: Simple Construction Bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. Spec**: Pending → implementation-plan.md
- [ ] **2. Implement**: Pending → implementation-walkthrough.md
- [ ] **3. Test**: Pending → test-walkthrough.md

## Dependencies

### Requires
- bolt-sidebar-provider-2 (existing tree implementation to migrate)
- bolt-artifact-parser-2 (dependency and activity data)

### Enables
- bolt-sidebar-provider-4 (detailed UI components)

## Success Criteria

- [ ] WebviewViewProvider registered and working
- [ ] Three tabs display and switch correctly
- [ ] Tab state persists across sessions
- [ ] Theme support (dark/light)
- [ ] Command center layout renders
- [ ] Current Intent header with statistics
- [ ] Section placeholders for Focus, Queue, Activity

## Notes

- **Design Reference**: `vs-code-extension/design-mockups/variation-8-2.html`
- Major architectural change from TreeView to Webview
- Use VS Code CSS variables for theming
- PostMessage API for communication

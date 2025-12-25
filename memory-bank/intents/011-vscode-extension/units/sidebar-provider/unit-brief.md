---
unit: sidebar-provider
intent: 011-vscode-extension
phase: inception
status: draft
created: 2025-12-25
updated: 2025-12-25
default_bolt_type: simple-construction-bolt
---

# Unit Brief: Sidebar Provider

## Purpose

Implement VS Code TreeDataProvider to render the memory-bank artifacts as a hierarchical tree view in the sidebar. Handle tree structure, icons, sorting, and visual presentation.

## Scope

### In Scope

- TreeDataProvider implementation for artifacts
- Tree item creation with icons, labels, descriptions
- Hierarchical structure (Intents → Units → Stories, Bolts → Stages/Stories)
- Status icon display (gray circle, yellow spinner, green check, yellow ?)
- Bolt type badges (DDD, Simple)
- Sorting (intents by number, bolts by progress)
- Configurable bolt grouping
- Expand/collapse support
- Pixel logo footer (webview)
- Tree refresh on data changes

### Out of Scope

- File parsing (handled by artifact-parser)
- File watching (handled by file-watcher)
- Command handling (handled by extension-core)
- Welcome view (handled by welcome-view)

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-1.2 | Display memory-bank artifacts in tree structure | Must |
| FR-1.5 | Display pixel logo as fadeout footer | Should |
| FR-2.1 | Intents as top-level items | Must |
| FR-2.2 | Units nested under intents | Must |
| FR-2.3 | Stories nested under units | Must |
| FR-2.4 | Bolts in separate section with unit grouping | Must |
| FR-2.5 | Standards in separate section | Must |
| FR-2.6 | Expand/collapse for all parent nodes | Must |
| FR-2.7 | Sort intents by number prefix | Must |
| FR-2.8 | Configurable bolt sorting | Must |
| FR-3.5 | Status icons (gray/yellow/green/?) | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| SpecsmdTreeDataProvider | Main provider class | model, onDidChangeTreeData |
| TreeNode | Base tree item | id, label, type, children, status |
| IntentNode | Intent tree item | intent data, units[] |
| UnitNode | Unit tree item | unit data, stories[] |
| StoryNode | Story tree item | story data |
| BoltNode | Bolt tree item | bolt data, stages[], stories[] |
| StageNode | Stage tree item | stage data |
| SectionNode | Section header | title (Intents, Bolts, Standards) |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| getTreeItem | Convert node to TreeItem | TreeNode | vscode.TreeItem |
| getChildren | Get child nodes | TreeNode? | TreeNode[] |
| refresh | Trigger tree refresh | - | void |
| buildTree | Build tree from parsed data | MemoryBankModel | TreeNode[] |
| sortIntents | Sort by number prefix | IntentNode[] | IntentNode[] |
| sortBolts | Sort by status/number | BoltNode[], sortMode | BoltNode[] |
| getStatusIcon | Get icon for status | ArtifactStatus | vscode.ThemeIcon |

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 5 |
| Must Have | 4 |
| Should Have | 1 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Tree Data Provider Setup | Must | Planned |
| 002 | Intent/Unit/Story Tree | Must | Planned |
| 003 | Bolt Tree with Stages and Stories | Must | Planned |
| 004 | Status Icons and Badges | Must | Planned |
| 005 | Pixel Logo Footer | Should | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| artifact-parser | Gets parsed artifact data |
| file-watcher | Subscribes to refresh events |

### Depended By

| Unit | Reason |
|------|--------|
| extension-core | Registers provider |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| VS Code TreeView API | Tree rendering | Low |
| VS Code Webview API | Logo footer | Low |

---

## Technical Context

### Suggested Technology

- vscode.TreeDataProvider interface
- vscode.TreeItem for items
- vscode.ThemeIcon for status icons
- Webview for footer (or TreeView description)

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| VS Code TreeView | API | TreeDataProvider |
| artifact-parser | Import | TypeScript |
| file-watcher | Event | Callback/EventEmitter |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Tree state | In-memory | Small | Session |
| Sort preferences | VS Code settings | Tiny | Persistent |

---

## Constraints

- Must follow VS Code TreeView patterns
- Icons must use ThemeIcon for theme compatibility
- Footer may require webview (explore alternatives first)

---

## Success Criteria

### Functional

- [ ] Tree displays all artifact types (intents, units, stories, bolts, standards)
- [ ] Proper nesting (intents → units → stories)
- [ ] Bolts show stages and stories as children
- [ ] Status icons display correctly for all states
- [ ] Bolt type badge visible
- [ ] Intents sorted by number
- [ ] Bolts sortable by progress/status
- [ ] Tree refreshes on file changes

### Non-Functional

- [ ] Tree renders 100 items in < 300ms
- [ ] Smooth expand/collapse animations
- [ ] Icons match VS Code theme

### Quality

- [ ] Unit tests for tree building logic
- [ ] Visual regression tests (screenshots)
- [ ] Code coverage > 80%

---

## Bolt Suggestions

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| bolt-sidebar-provider-1 | Simple | 001, 002 | Basic tree structure |
| bolt-sidebar-provider-2 | Simple | 003, 004, 005 | Bolts, status, footer |

---

## Notes

- Tree structure visualization (from requirements):
```
▶ Intents
  └─ 001-multi-agent-orchestration ✅
       └─ master-agent ✅
            └─ 001-activation.md ✅
       └─ inception-agent ✅
  └─ 011-vscode-extension 🔄
       └─ artifact-parser ○
       └─ sidebar-provider ○

▶ Bolts
  └─ 🔄 bolt-auth-service-1 [DDD] Stage: Implementation
       ├─ 📋 Stages
       │    └─ ✅ Domain Model
       │    └─ 🔄 Implementation
       └─ 📖 Stories
            └─ ✅ 001-user-login

▶ Standards
  └─ tech-stack.md
  └─ coding-standards.md
```
- Consider using TreeItemCollapsibleState for expand/collapse
- Bolt type badge can be shown in TreeItem.description

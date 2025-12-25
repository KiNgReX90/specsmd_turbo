---
intent: vscode-extension
created: 2025-12-25T16:45:00Z
completed: null
status: in-progress
---

# Inception Log: vscode-extension

## Overview

**Intent**: VS Code extension with dashboard sidebar for browsing AI-DLC memory-bank artifacts
**Type**: green-field
**Created**: 2025-12-25

## Artifacts Created

| Artifact | Status | File |
|----------|--------|------|
| Requirements | ✅ | requirements.md |
| System Context | ⏳ | system-context.md |
| Units | ⏳ | units.md |
| Stories | ⏳ | units/{unit-name}/stories/*.md |
| Bolt Plan | ⏳ | memory-bank/bolts/bolt-*.md |

## Summary

| Metric | Count |
|--------|-------|
| Functional Requirements | 7 (FR-1 to FR-7) |
| Future Requirements | 2 (FR-8, FR-9) |
| Non-Functional Requirements | 4 |
| Units | TBD |
| Stories | TBD |
| Bolts Planned | TBD |

## Units Breakdown

| Unit | Stories | Bolts | Priority |
|------|---------|-------|----------|
| TBD | TBD | TBD | TBD |

## Decision Log

| Date | Decision | Rationale | Approved |
|------|----------|-----------|----------|
| 2025-12-25 | Separate extension, not fabriqa fork | Clean separation, different purpose | Yes |
| 2025-12-25 | Dashboard only (no editor) Phase 1 | Reduce scope, faster delivery | Yes |
| 2025-12-25 | Use default VS Code editor | Leverage existing tools | Yes |
| 2025-12-25 | Location: vs-code-extension/ | Keep in specsmd monorepo | Yes |
| 2025-12-25 | No multi-root workspace support | Simplify implementation | Yes |
| 2025-12-25 | Show ALL bolt stages (not just current) | Better visibility of progress | Yes |
| 2025-12-25 | Extension name: "specsmd extension" | Consistent branding | Yes |
| 2025-12-25 | Add installation prompt for new projects | Onboarding experience | Yes |
| 2025-12-25 | Use favicon.svg for activity bar icon | Consistent branding | Yes |
| 2025-12-25 | Add pixel logo fadeout footer in sidebar | Brand presence | Yes |
| 2025-12-25 | Add refresh button in sidebar title bar | Manual refresh option | Yes |
| 2025-12-25 | Real-time updates is Must priority | Core functionality | Yes |
| 2025-12-25 | Specific status icons (gray/yellow/green) | Clear visual language | Yes |
| 2025-12-25 | Sort intents by number prefix | Logical ordering | Yes |
| 2025-12-25 | Bolts: in-progress first, configurable grouping | Prioritize active work | Yes |

## Scope Changes

| Date | Change | Reason | Impact |
|------|--------|--------|--------|

## Ready for Construction

**Checklist**:
- [x] All requirements documented
- [ ] System context defined
- [ ] Units decomposed
- [ ] Stories created for all units
- [ ] Bolts planned
- [ ] Human review complete

## Next Steps

1. Define system context (interactions with VS Code, memory-bank)
2. Decompose into units (sidebar-provider, artifact-parser, file-watcher, etc.)
3. Create stories for each unit
4. Plan bolts for construction

## Dependencies

- Requires stable memory-bank schema (memory-bank.yaml)
- No dependencies on other specsmd intents

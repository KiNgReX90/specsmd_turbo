---
unit: artifact-parser
intent: 011-vscode-extension
phase: inception
status: draft
created: 2025-12-25
updated: 2025-12-25
default_bolt_type: simple-construction-bolt
---

# Unit Brief: Artifact Parser

## Purpose

Parse memory-bank directory structure and artifact files to build a model of AI-DLC artifacts with their statuses. This is the foundation unit that other units depend on for understanding the memory-bank content.

## Scope

### In Scope

- Central `MemoryBankSchema` class with hardcoded paths (future: dynamic from memory-bank.yaml)
- Directory scanning for intents, units, stories, bolts, standards
- YAML frontmatter parsing from markdown files
- Status extraction and normalization
- Project detection (is this a specsmd project?)
- Graceful handling of missing/malformed files

### Out of Scope

- File system watching (handled by file-watcher unit)
- Tree view rendering (handled by sidebar-provider unit)
- File modification/creation

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-1.4 | Auto-detect specsmd projects (presence of `memory-bank/` or `.specsmd/`) | Must |
| FR-3.1 | Parse intent status (draft, in-progress, complete) | Must |
| FR-3.2 | Calculate unit completion status | Must |
| FR-3.3 | Parse story status (pending, in-progress, done) | Must |
| FR-3.4 | Parse bolt status, type, stages, stories | Must |
| FR-6.1 | Central `MemoryBankSchema` class for path definitions | Must |
| FR-6.2 | Hardcoded paths for Phase 1 | Must |
| FR-6.3 | Design for future dynamic discovery | Should |
| FR-6.4 | Parse artifact frontmatter for status | Must |
| FR-6.5 | Handle missing/malformed frontmatter gracefully | Must |
| FR-6.6 | Support standard memory-bank directory structure | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| MemoryBankSchema | Central path/structure definitions | paths, patterns, getIntentsPath(), getBoltsPath() |
| Intent | Feature/capability container | name, number, status, units[] |
| Unit | Deployable work unit | name, intent, status, stories[], dependencies |
| Story | User story | id, title, status, unit |
| Bolt | Construction session | id, type, status, currentStage, stages[], stories[] |
| Stage | Bolt execution stage | name, status, order |
| Standard | Project standard | name, path |
| ArtifactStatus | Normalized status | draft/pending, in-progress, complete/done, unknown |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| detectProject | Check if workspace is specsmd project | workspacePath | boolean |
| scanMemoryBank | Scan and parse all artifacts | workspacePath | MemoryBankModel |
| parseIntent | Parse single intent folder | intentPath | Intent |
| parseUnit | Parse single unit folder | unitPath | Unit |
| parseBolt | Parse single bolt folder | boltPath | Bolt |
| parseFrontmatter | Extract YAML frontmatter | fileContent | FrontmatterData |
| normalizeStatus | Convert status string to enum | rawStatus | ArtifactStatus |

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 4 |
| Must Have | 4 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Memory Bank Schema Class | Must | Planned |
| 002 | Project Detection | Must | Planned |
| 003 | Artifact Parsing | Must | Planned |
| 004 | Frontmatter Parser | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| None | Foundation unit |

### Depended By

| Unit | Reason |
|------|--------|
| sidebar-provider | Needs parsed artifact data |
| file-watcher | Needs to re-parse on changes |
| welcome-view | Needs project detection |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| Node.js fs | File system access | Low |
| js-yaml | YAML frontmatter parsing | Low |

---

## Technical Context

### Suggested Technology

- TypeScript classes for models
- js-yaml for frontmatter parsing
- VS Code workspace API for paths
- Glob patterns for file discovery

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| VS Code workspace | API | vscode.workspace |
| File System | API | Node.js fs/promises |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| In-memory models | TypeScript objects | Small (<1MB) | Session |

---

## Constraints

- Must be synchronous-friendly for initial load (or fast async)
- Must handle 100+ artifacts without performance issues
- Must not throw on malformed files (graceful degradation)

---

## Success Criteria

### Functional

- [ ] MemoryBankSchema defines all paths in one place
- [ ] detectProject correctly identifies specsmd projects
- [ ] All artifact types parsed correctly (intents, units, stories, bolts, standards)
- [ ] Frontmatter parsing extracts status fields
- [ ] Malformed files return "unknown" status, not errors

### Non-Functional

- [ ] Parse 100 artifacts in < 200ms
- [ ] No memory leaks from repeated parsing

### Quality

- [ ] Unit tests for all parsing functions
- [ ] Test fixtures for valid/invalid frontmatter
- [ ] Code coverage > 80%

---

## Bolt Suggestions

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| bolt-artifact-parser-1 | Simple | 001, 002, 003, 004 | All artifact-parser functionality |

---

## Notes

- MemoryBankSchema should be designed with dependency injection in mind for future dynamic loading
- Consider caching parsed results to avoid re-parsing unchanged files
- Status normalization should handle variations (e.g., "completed" vs "complete")

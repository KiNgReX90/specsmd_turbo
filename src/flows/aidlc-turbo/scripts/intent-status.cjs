#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - intent status.
 *
 * Reads one intent's brief and stories and prints what construction needs to
 * decide its next move: every story with its status, dependencies, complexity,
 * the files it touches and changed, its miss count (`misses`), where a tester
 * checks each criterion (`observed_via`, null on a story rendered before that
 * field), the frontier (todo stories whose dependencies are all done) and its
 * file, the blocked ones, the brief frontmatter, the brief's
 * verification commands, `shared_files`: every file that more than one
 * story touches or changed, and `project_docs`: the project's rules for code in
 * reading batches, for the docs reviewers of a fix at finish, and
 * `turbo_version`: the version of the flow that runs (lib/flow-version.cjs),
 * which construction compares with the brief's own `turbo_version`, the one
 * the inception was approved with. The construction agent reads only this,
 * never the story bodies or the standards. --version prints that version alone.
 *
 * With story branches on, it also says per story where its branch starts:
 * `stack_on` is "intent" for a story without dependencies, otherwise the
 * dependency that comes last in build order. `merge_in` lists the other
 * dependencies, whose branches get merged into the new branch.
 *
 * The other construction scripts (story-start, story-verify, story-land,
 * story-complete) read the intent through the functions exported here.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/intent-status.cjs <intent-slug> [--json] [--root .specs-aidlc-turbo]
 *   node .specsmd/aidlc-turbo/scripts/intent-status.cjs --version
 *
 * Node builtins only, plus ./frontmatter.cjs, ./lib/paths.cjs and
 * ./lib/project-docs.cjs: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { extractFrontmatter } = require('./frontmatter.cjs');
const paths = require('./lib/paths.cjs');
const { projectDocs } = require('./lib/project-docs.cjs');
const { flowVersion } = require('./lib/flow-version.cjs');

const DEFAULT_ROOT = paths.ARTIFACT_DIR;

const useColor = process.stdout.isTTY === true;
const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = (t) => c('31', t);
const dim = (t) => c('90', t);
const bright = (t) => c('1', t);

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], json: false, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json') out.json = true;
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg === '--version') out.version = true;
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

/** A bare number becomes the 3-digit story id: 3 and 003 are the same story. */
function normId(id) {
    const text = String(id).trim();
    return /^\d+$/.test(text) ? text.padStart(3, '0') : text;
}

const asList = (v) => (Array.isArray(v) ? v.map(String) : []);

/**
 * Find the intent by slug under docs/. Returns { intent } or { error }. The
 * old layout stops here with the one-line move instruction.
 */
function resolveIntent(root, slug) {
    if (paths.isLegacy(root)) return { error: paths.legacyMessage(root) };
    try {
        const intent = paths.findIntent(root, slug);
        if (!intent) return { error: `intent not found: ${slug} under ${paths.layout(root).docs}` };
        return { intent };
    } catch (error) {
        return { error: error.message };
    }
}

/** Read one story file into the fields construction uses. */
function readStory(file) {
    const fm = extractFrontmatter(fs.readFileSync(file, 'utf8')) || {};
    const name = path.basename(file, '.md');
    const parts = name.match(/^(\d+)-?(.*)$/);
    return {
        id: fm.id != null ? normId(fm.id) : (parts ? parts[1] : name),
        slug: parts && parts[2] ? parts[2] : name,
        title: fm.title || name,
        status: fm.status || 'todo',
        depends_on: asList(fm.depends_on).map(normId),
        tester_verifiable: fm.tester_verifiable === true,
        observed_via: Array.isArray(fm.observed_via) ? fm.observed_via.map(String) : null,
        break_test: fm.break_test === true,
        branch: fm.branch ? String(fm.branch) : null,
        complexity: fm.complexity ? String(fm.complexity) : null,
        touches: asList(fm.touches),
        changed_files: asList(fm.changed_files),
        db_tables: asList(fm.db_tables),
        file,
        frontmatter: fm,
    };
}

/** Read every story of the intent, sorted by file name. */
function readStories(intent) {
    if (!fs.existsSync(intent.stories)) return [];
    return fs.readdirSync(intent.stories)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => readStory(path.join(intent.stories, f)));
}

/** Find one story by id (3 or 003), full file name or slug. */
function findStory(intent, storyId) {
    const wanted = normId(String(storyId).replace(/\.md$/, ''));
    return readStories(intent).find((s) => s.id === wanted
        || path.basename(s.file, '.md') === wanted
        || path.basename(s.file).startsWith(`${wanted}-`)) || null;
}

/** The commands of the brief's `## Verification` section, in order. */
function parseVerification(body) {
    const lines = String(body || '').split('\n');
    const start = lines.findIndex((l) => /^##\s+Verification\s*$/.test(l));
    if (start < 0) return [];
    const commands = [];
    let fenced = false;
    for (const line of lines.slice(start + 1)) {
        if (!fenced && /^#{1,2}\s/.test(line)) break;
        if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
        if (fenced) {
            if (line.trim()) commands.push(line.trim());
            continue;
        }
        const item = line.match(/^\s*[-*]\s+(.*)$/);
        if (!item) continue;
        const code = item[1].match(/`([^`]+)`/);
        const text = code ? code[1] : item[1].replace(/^\*\*[^*]+\*\*:\s*/, '');
        if (text.trim() && !/^none\.?$/i.test(text.trim())) commands.push(text.trim());
    }
    return commands;
}

/** Brief frontmatter plus its verification commands; status "missing" when there is no brief. */
function readBrief(intent) {
    if (!fs.existsSync(intent.brief)) return { status: 'missing', frontmatter: {}, verification: [] };
    const content = fs.readFileSync(intent.brief, 'utf8');
    const frontmatter = extractFrontmatter(content) || {};
    return {
        status: frontmatter.status || 'unknown',
        frontmatter,
        verification: parseVerification(content),
    };
}

/** Frontier = todo stories whose dependencies all exist and are done. */
function computeFrontier(stories) {
    const byId = new Map(stories.map((s) => [s.id, s]));
    return stories
        .filter((s) => s.status === 'todo')
        .filter((s) => s.depends_on.every((d) => byId.get(d) && byId.get(d).status === 'done'))
        .map((s) => s.id);
}

/**
 * Build order: a topological sort that keeps file order among equals, so it
 * matches the order the dispatch loop picks stories from the frontier. A
 * cycle remainder is appended in file order; spec-lint already refuses cycles.
 */
function buildOrder(stories) {
    const ids = stories.map((s) => s.id);
    const known = new Set(ids);
    const deps = new Map(stories.map((s) => [s.id, s.depends_on.filter((d) => known.has(d) && d !== s.id)]));
    const order = [];
    const placed = new Set();
    let progressed = true;
    while (order.length < ids.length && progressed) {
        progressed = false;
        for (const id of ids) {
            if (!placed.has(id) && deps.get(id).every((d) => placed.has(d))) {
                order.push(id);
                placed.add(id);
                progressed = true;
                break;
            }
        }
    }
    ids.filter((id) => !placed.has(id)).forEach((id) => order.push(id));
    return order;
}

/** Where each story's branch starts: the intent branch or a dependency's branch. */
function branchPlan(stories) {
    const order = buildOrder(stories);
    const rank = new Map(order.map((id, i) => [id, i]));
    const plan = new Map();
    for (const s of stories) {
        const deps = s.depends_on.filter((d) => rank.has(d));
        if (deps.length === 0) {
            plan.set(s.id, { stack_on: 'intent', merge_in: [] });
            continue;
        }
        const last = deps.reduce((a, b) => (rank.get(b) > rank.get(a) ? b : a));
        plan.set(s.id, { stack_on: last, merge_in: deps.filter((d) => d !== last) });
    }
    return plan;
}

/** Files that more than one story touches or changed, sorted by path. */
function sharedFiles(stories) {
    const byFile = new Map();
    for (const s of stories) {
        for (const file of new Set([...s.touches, ...s.changed_files])) {
            if (!byFile.has(file)) byFile.set(file, []);
            byFile.get(file).push(s.id);
        }
    }
    return [...byFile.entries()]
        .filter(([, ids]) => ids.length > 1)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, ids]) => ({ file, stories: ids }));
}

/** The whole status of one intent, as the --json output prints it. */
function statusPayload(intent) {
    const brief = readBrief(intent);
    const stories = readStories(intent);
    const plan = branchPlan(stories);
    return {
        intent: intent.slug,
        inception: intent.inception,
        brief_status: brief.status,
        brief: brief.frontmatter,
        verification: brief.verification,
        stories: stories.map((s) => ({
            id: s.id,
            slug: s.slug,
            file: path.relative(process.cwd(), path.resolve(s.file)).split(path.sep).join('/'),
            title: s.title,
            status: s.status,
            depends_on: s.depends_on,
            complexity: s.complexity,
            touches: s.touches,
            changed_files: s.changed_files,
            misses: Number(s.frontmatter.misses) || 0,
            tester_verifiable: s.tester_verifiable,
            observed_via: s.observed_via,
            break_test: s.break_test,
            branch: s.branch,
            stack_on: plan.get(s.id).stack_on,
            merge_in: plan.get(s.id).merge_in,
        })),
        frontier: computeFrontier(stories),
        blocked: stories.filter((s) => s.status === 'blocked').map((s) => s.id),
        shared_files: sharedFiles(stories),
        turbo_version: flowVersion(),
    };
}

function renderTable(stories) {
    const rows = stories.map((s) => [
        s.id,
        s.title.length > 46 ? `${s.title.slice(0, 43)}...` : s.title,
        s.status,
        s.depends_on.length ? s.depends_on.join(', ') : '-',
    ]);
    const header = ['Story', 'Title', 'Status', 'Depends on'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
    const out = [line(header), widths.map((w) => '-'.repeat(w)).join('  ')];
    rows.forEach((r) => out.push(line(r)));
    return out.join('\n');
}

function intentStatus(options) {
    const { positional, json, root } = options;
    const slug = positional[0];

    if (!slug) {
        console.error(red('Error:'), 'intent slug is required');
        console.error(dim('Usage: node intent-status.cjs <intent-slug> [--json] [--root <dir>]'));
        return 2;
    }

    const { intent, error } = resolveIntent(root, slug);
    if (error) {
        console.error(red('Error:'), error);
        return 1;
    }

    const payload = statusPayload(intent);
    if (json) {
        console.log(JSON.stringify({ ...payload, project_docs: projectDocs(root, process.cwd()) }, null, 2));
        return 0;
    }

    const stories = payload.stories;
    const done = stories.filter((s) => s.status === 'done').length;
    console.log(bright(`Intent ${payload.intent}`));
    console.log(dim(`Brief: ${payload.brief_status}   Stories: ${done}/${stories.length} done`));
    console.log();
    if (stories.length === 0) {
        console.log(dim('No stories found. Run inception first.'));
        return 0;
    }
    console.log(renderTable(stories));
    console.log();
    console.log(`Frontier: ${payload.frontier.length ? payload.frontier.join(', ') : 'none'}`);
    console.log(`Blocked:  ${payload.blocked.length ? payload.blocked.join(', ') : 'none'}`);
    if (done === stories.length) {
        console.log('\nAll stories done, run finish');
    } else if (payload.frontier.length === 0 && payload.blocked.length > 0) {
        console.log('\nNothing can start: resolve the blocked stories first');
    }
    return 0;
}

module.exports = {
    DEFAULT_ROOT,
    normId,
    resolveIntent,
    readStory,
    readStories,
    findStory,
    parseVerification,
    readBrief,
    computeFrontier,
    buildOrder,
    branchPlan,
    sharedFiles,
    statusPayload,
};

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(`
Usage: node intent-status.cjs <intent-slug> [options]

Options:
  --json          Print one JSON object instead of the table
  --root <dir>    Artifact root, default ${DEFAULT_ROOT}
  --version       Print the version of this flow, no intent needed
  --help, -h      Show this message
`);
        process.exit(0);
    }
    if (options.version) {
        console.log(flowVersion() || 'unknown');
        process.exit(0);
    }
    try {
        process.exitCode = intentStatus(options);
    } catch (error) {
        console.error(red('Error:'), error.message);
        process.exitCode = 1;
    }
}

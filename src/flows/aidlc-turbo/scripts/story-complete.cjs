#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - story completion gate.
 *
 * Marks one story done after its reviewer passed it. Hard gate: refuses when the
 * story file is missing, when the story is not in `building` or `review`, or when
 * no test summary is given. Nothing else in the tree is touched; the brief is the
 * finish skill's business. story-land.cjs calls this gate; it is also run by hand
 * on hosts that land a story themselves.
 *
 * --tests is the one line test summary, prose, never a path and never a folder.
 * It is written into the story frontmatter as `tests:`, where the Jira close
 * reads it. This script writes no test artifacts and creates no directory. --files records
 * the files the story changed (`changed_files`), which intent-status.cjs reads for
 * `shared_files`.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/story-complete.cjs <intent-slug> <story-id> \
 *     --tests "<summary>" [--commit <sha>] [--branch <name>] [--files a,b] [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./frontmatter.cjs and ./lib/paths.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { extractFrontmatter, updateFrontmatter, getDate } = require('./frontmatter.cjs');
const { DEFAULT_ROOT, resolveIntent, findStory, readStories } = require('./intent-status.cjs');

const DONE_STATUS = 'done';
const ALLOWED_FROM = ['building', 'review'];

const useColor = process.stdout.isTTY === true;
const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (t) => c('32', t);
const red = (t) => c('31', t);
const dim = (t) => c('90', t);

/** Split a comma list into trimmed, non-empty items. */
const splitList = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], tests: null, commit: null, branch: null, files: null, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--tests') { out.tests = argv[i + 1] ?? null; i += 1; }
        else if (arg === '--commit') { out.commit = argv[i + 1] ?? null; i += 1; }
        else if (arg === '--branch') { out.branch = argv[i + 1] ?? null; i += 1; }
        else if (arg === '--files') { out.files = splitList(argv[i + 1]); i += 1; }
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') { out.help = true; }
        else if (!arg.startsWith('--')) { out.positional.push(arg); }
    }
    return out;
}

/**
 * The gate without the write: returns { story, intent } when the story may be
 * marked done, else { error }.
 */
function checkComplete({ root, intentSlug, storyId, tests }) {
    if (!tests || !String(tests).trim()) {
        return { error: '--tests is empty. Pass the one line test summary, not a path.' };
    }
    const { intent, error } = resolveIntent(root, intentSlug);
    if (error) return { error };
    const story = findStory(intent, storyId);
    if (!story) return { error: `story not found: ${storyId} in ${intent.stories}` };
    if (!extractFrontmatter(fs.readFileSync(story.file, 'utf8'))) {
        return { error: `story has no readable frontmatter: ${story.file}` };
    }
    if (story.status === DONE_STATUS) return { error: `story ${story.id} is already done.` };
    if (!ALLOWED_FROM.includes(story.status)) {
        return { error: `story ${story.id} has status "${story.status}", expected one of: ${ALLOWED_FROM.join(', ')}.` };
    }
    return { story, intent };
}

/**
 * Mark the story done. Returns { ok, file, from, commit, branch, done, total }
 * or { error }.
 */
function completeStory(options) {
    const gate = checkComplete(options);
    if (gate.error) return gate;
    const { story, intent } = gate;
    const content = fs.readFileSync(story.file, 'utf8');
    const next = {
        ...extractFrontmatter(content),
        status: DONE_STATUS,
        completed: getDate(),
        commit: options.commit || null,
        tests: String(options.tests).trim(),
    };
    if (options.branch) next.branch = options.branch;
    if (options.files && options.files.length) next.changed_files = options.files;
    const rewritten = updateFrontmatter(content, next);
    if (!rewritten) return { error: `failed to rewrite frontmatter: ${story.file}` };
    fs.writeFileSync(story.file, rewritten, 'utf8');

    const stories = readStories(intent);
    return {
        ok: true,
        id: story.id,
        file: story.file,
        from: story.status,
        commit: next.commit,
        branch: next.branch || null,
        done: stories.filter((s) => s.status === DONE_STATUS).length,
        total: stories.length,
    };
}

function storyComplete(options) {
    const [intentSlug, storyId] = options.positional;
    if (!intentSlug || !storyId) {
        console.error(red('Error:'), 'intent slug and story id are required');
        console.error(dim('Usage: node story-complete.cjs <intent-slug> <story-id> --tests "<summary>" [--commit <sha>] [--branch <name>] [--files a,b] [--root <dir>]'));
        return 2;
    }
    const result = completeStory({ ...options, intentSlug, storyId });
    if (result.error) {
        console.error(red('Refused:'), result.error);
        return 1;
    }
    console.log(`${green('OK')} ${path.basename(result.file)}: ${result.from} -> ${DONE_STATUS}`);
    console.log(dim(`  tests:  ${String(options.tests).trim()}`));
    console.log(dim(`  commit: ${result.commit || 'none'}`));
    if (result.branch) console.log(dim(`  branch: ${result.branch}`));
    console.log(dim(`  stories done: ${result.done}/${result.total}`));
    if (result.done === result.total) console.log(green('All stories done, run finish'));
    return 0;
}

module.exports = { DONE_STATUS, ALLOWED_FROM, checkComplete, completeStory };

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(`
Usage: node story-complete.cjs <intent-slug> <story-id> --tests "<summary>" [options]

Options:
  --tests <summary>   One line test summary, prose not a path (required)
  --commit <sha>      Commit that carries the story
  --branch <name>     The story's own branch (story branches on)
  --files <a,b>       Files the story changed, recorded as changed_files
  --root <dir>        Artifact root, default ${DEFAULT_ROOT}
  --help, -h          Show this message
`);
        process.exit(0);
    }
    try {
        process.exitCode = storyComplete(options);
    } catch (error) {
        console.error(red('Error:'), error.message);
        process.exitCode = 1;
    }
}

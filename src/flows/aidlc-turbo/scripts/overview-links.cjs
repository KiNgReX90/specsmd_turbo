#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - put the merge requests on the intent's overview.
 *
 * Finish shows the overview for the approval before anything is pushed; the
 * push then writes the link of every merge request into the brief and the
 * story files (push-branch.cjs). This script puts those links on the page
 * that was approved, so the Review tab leads from each file to its change in
 * the merge request (lib/review-links.cjs), without rendering the page again: the diffs
 * stay as they were approved.
 *
 * Prints { overview, links } with the number of merge requests on the page.
 * Exit 0 written, 1 no such intent or no overview with page data, 2 usage.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/overview-links.cjs <intent-slug> [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./intent-status.cjs and ./lib/review-links.cjs.
 */

const fs = require('fs');
const { DEFAULT_ROOT, resolveIntent, readStories, readBrief } = require('./intent-status.cjs');
const { relink } = require('./lib/review-links.cjs');

const USAGE = 'Usage: node .specsmd/aidlc-turbo/scripts/overview-links.cjs <intent-slug> [--root .specs-aidlc-turbo]';

function main(argv) {
    const args = [...argv];
    let root = DEFAULT_ROOT;
    const at = args.indexOf('--root');
    if (at >= 0) { root = args[at + 1]; args.splice(at, 2); }
    if (args.length !== 1 || !root || args[0].startsWith('-')) { console.error(USAGE); return 2; }
    const { intent, error } = resolveIntent(root, args[0]);
    if (error) { console.error(error); return 1; }
    if (!fs.existsSync(intent.overview)) { console.error(`No overview yet: ${intent.overview}`); return 1; }
    const brief = readBrief(intent).frontmatter;
    const stories = readStories(intent).map((s) => ({ id: s.id, data: s.frontmatter }));
    const html = relink(fs.readFileSync(intent.overview, 'utf8'), { brief, stories });
    if (html === null) { console.error(`No page data in ${intent.overview}`); return 1; }
    fs.writeFileSync(intent.overview, html);
    const links = [brief, ...stories.map((s) => s.data)].filter((d) => d && /^https?:\/\//.test(String(d.merge_request || '').trim())).length;
    console.log(JSON.stringify({ overview: intent.overview, links }));
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };

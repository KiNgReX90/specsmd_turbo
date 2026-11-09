/**
 * specsmd AI-DLC Turbo - the project's rules for code, in reading batches.
 *
 * The standards (repo/standards/) and the Project Documentation (project/pages/,
 * nested folders pulled from Confluence) hold the rules every story is built and
 * reviewed by. The docs reviewer of a story reads one batch: all of them for a
 * normal project, and only for a really large documentation set is it split, so
 * no reviewer judges a change against more rules than it can keep in view. The
 * root index.md, the map of where every rule lives, is read by every docs
 * reviewer and is in no batch.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths.cjs');

/** About the words one docs reviewer reads with care; the Project Documentation of a normal project fits. */
const MAX_WORDS = 20000;

/** Every markdown file under `dir`, nested folders included, in path order. */
function markdownUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...markdownUnder(file));
        else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(file);
    }
    return out.sort();
}

const words = (file) => (fs.readFileSync(file, 'utf8').match(/\S+/g) || []).length;

/** Pack files into batches of at most `max` words, in order; a file bigger than `max` is a batch of its own. */
function batch(files, max) {
    const batches = [];
    let current = [];
    let size = 0;
    for (const { file, n } of files) {
        if (current.length && size + n > max) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(file);
        size += n;
    }
    if (current.length) batches.push(current);
    return batches;
}

/**
 * The project's rules for code: { index, batches }. `index` is the root index.md
 * of the Project Documentation, or null; `batches` holds arrays of absolute paths,
 * the standards first, then the pages in path order so a folder stays together.
 */
function projectDocs(root, projectRoot, max = MAX_WORDS) {
    const layout = paths.layout(root);
    const pages = path.resolve(projectRoot, layout.projectPages);
    const index = path.join(pages, 'index.md');
    const files = [
        ...markdownUnder(path.resolve(projectRoot, layout.standards)),
        ...markdownUnder(pages).filter((f) => f !== index),
    ];
    return {
        index: fs.existsSync(index) ? index : null,
        batches: batch(files.map((file) => ({ file, n: words(file) })), max),
    };
}

module.exports = { MAX_WORDS, projectDocs };

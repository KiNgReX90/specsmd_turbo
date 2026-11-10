'use strict';

/**
 * The Jira keys of one intent, as the after-inception sync wrote them into
 * `docs/{inception}/sync.yaml`:
 *
 *   jira:
 *     intents:
 *       {intent-slug}:
 *         epic: SHOP-100
 *         stories:
 *           "001": SHOP-101
 *
 * An older sync.yaml keeps `epic` and `stories` directly under `jira:`; they
 * belong to the intent with the inception's own slug.
 *
 * push-branch.cjs starts every merge request title with the key
 * (`SHOP-642 - Gift card balance on the order page`). Never throws: no file,
 * no block or no key reads as no key.
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require('./yaml-subset.cjs');

const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asKey = (v) => (v != null && JIRA_KEY.test(String(v).trim()) ? String(v).trim() : null);
const storyId = (id) => (/^\d+$/.test(String(id)) ? String(id).padStart(3, '0') : String(id));

/** { epic, stories: { "001": KEY } } of one intent (paths.cjs intentPaths). */
function jiraKeys(intent) {
    let sync = {};
    try {
        sync = parseYaml(fs.readFileSync(path.join(path.dirname(intent.dir), 'sync.yaml'), 'utf8')) || {};
    } catch {
        sync = {};
    }
    const jira = isMap(sync) && isMap(sync.jira) ? sync.jira : {};
    let block = isMap(jira.intents) && isMap(jira.intents[intent.slug]) ? jira.intents[intent.slug] : null;
    if (!block && intent.slug === intent.inception && (jira.epic || jira.stories)) block = jira;
    const stories = {};
    if (block && isMap(block.stories)) {
        for (const [id, value] of Object.entries(block.stories)) {
            if (asKey(value)) stories[storyId(id)] = asKey(value);
        }
    }
    return { epic: block ? asKey(block.epic) : null, stories };
}

/** `KEY - title`, or the title alone when there is no key. */
const withKey = (key, title) => (key ? `${key} - ${title}` : String(title));

/** The title a merge request shows: the story's or brief's title, in the record's language. */
const shownTitle = (fm, fallback) => String((fm && fm.title) || fallback);

module.exports = { jiraKeys, withKey, shownTitle };

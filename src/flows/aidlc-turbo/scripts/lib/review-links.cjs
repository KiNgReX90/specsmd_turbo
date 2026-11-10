/**
 * specsmd AI-DLC Turbo - the merge requests on the overview after the push.
 *
 * Finish pushes every branch and writes the link of its merge request into
 * the brief (the intent's) and into every story file (with story branches),
 * as `merge_request` (push-branch.cjs). Rendered again after that, the
 * overview leads from each file in its Review tab to the merge request that
 * holds its change. addLinks(model, { brief, stories }) puts them on a model
 * whose build block addDiffs already enriched (the v5 model, or the
 * designModel it was made from):
 *
 *   model.build.links   { intent, stories: { [story id]: url }, anchors: { [part.path]: sha1 } }
 *
 *   intent    the brief's merge request, or null
 *   stories   every story's own, by its id ('001')
 *   anchors   per file in model.build.diffs the SHA-1 of its path, the
 *             anchor GitLab gives that file in the changes of a merge request
 *
 * putRequests(model, { brief, stories }) puts them on the band and the rail
 * of a v5 model: model.mr and model.mrN from the brief, and per story its
 * `url` and its number `mr`, its own merge request, else the intent's (a
 * story built on the intent branch is in that one).
 *
 * Only an http(s) link counts. No link at all, or no build on the model, is
 * no `links`: the page then shows none.
 *
 * The overview is approved before the push, so the push's links come on the
 * page afterwards: relink(html, { brief, stories }) puts them into the data
 * block of a rendered overview.html and leaves the rest as it is, the diffs
 * as they were approved among it (a fresh render on the intent branch would
 * have none: with story branches it carries only the specs). It replaces the
 * links it put there before; null when the page has no data block it can read.
 *
 * It reads the page's data block, `<script id="overview-data"
 * type="application/json">`, what intent-overview.cjs writes: the links go on
 * page.design.build, where its Review tab reads them. The C4 model it carries
 * is one JSON string with every `<` escaped (lib/overview-page.cjs), so this
 * block is never found inside it, and it needs no links.
 *
 * Node builtins only.
 */

const { createHash } = require('crypto');

const LINK = /^https?:\/\/\S+$/;
const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
const linkOf = (data) => {
    const v = data && data.merge_request;
    return typeof v === 'string' && LINK.test(v.trim()) ? v.trim() : null;
};
/** The number of a merge request (GitLab) or pull request (GitHub) in its link, or null. */
const numberOf = (url) => {
    const m = url ? /\/(?:merge_requests|pull)\/(\d+)/.exec(url) : null;
    return m ? Number(m[1]) : null;
};

// the data block of the page of templates/overview
const PAGE_OPEN = '<script id="overview-data" type="application/json">';
const PAGE_CLOSE = '</script>';

/** Every story's own merge request, by its id. */
function ownLinks(stories) {
    const own = {};
    for (const s of Array.isArray(stories) ? stories : []) {
        const url = s && linkOf(s.data);
        if (url) own[s.id] = url;
    }
    return own;
}

function addLinks(model, { brief, stories } = {}) {
    if (!model || !model.build) return model;
    const intent = linkOf(brief);
    const own = ownLinks(stories);
    if (!intent && !Object.keys(own).length) return model;
    const anchors = {};
    for (const p of Object.keys(model.build.diffs || {})) anchors[p] = createHash('sha1').update(norm(p)).digest('hex');
    model.build.links = { intent, stories: own, anchors };
    return model;
}

function putRequests(model, { brief, stories } = {}) {
    if (!model || typeof model !== 'object') return model;
    const intent = linkOf(brief);
    const own = ownLinks(stories);
    model.mr = intent;
    model.mrN = numberOf(intent);
    for (const u of Array.isArray(model.stories) ? model.stories : []) {
        if (!u || typeof u !== 'object') continue;
        u.url = own[u.id] || intent;
        u.mr = numberOf(u.url);
    }
    return model;
}

/** The links into the data block of the page of templates/overview; the page as it is when it has no build to link. */
function relink(html, input) {
    const at = html.indexOf(PAGE_OPEN);
    const end = at < 0 ? -1 : html.indexOf(PAGE_CLOSE, at + PAGE_OPEN.length);
    if (end < 0) return null;
    let page;
    try {
        // the JSON as lib/overview-page.cjs wrote it: `</` and `<!--` escaped so they cannot close the tag (an
        // older page wrote `<\!--`, which no JSON reads)
        page = JSON.parse(html.slice(at + PAGE_OPEN.length, end).replace(/<\\!--/g, '<!--'));
    } catch {
        return null;
    }
    if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
    if (!page.design || !page.design.build) return html;
    delete page.design.build.links;
    addLinks(page.design, input);
    const json = JSON.stringify(page).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');
    return html.slice(0, at + PAGE_OPEN.length) + json + html.slice(end);
}

module.exports = { addLinks, putRequests, relink, numberOf };

/**
 * specsmd AI-DLC Turbo - the open review threads of a GitLab merge request,
 * and a reply to one of them. Used by review-fix.cjs.
 *
 * A thread is open while it has a note a human wrote and a resolvable note
 * that is not resolved; a plain comment that cannot be resolved counts as
 * open too. A thread whose last note is a reply of the review fix (it ends in
 * MARKER) waits for the reviewer and is left out, until the reviewer writes
 * again. System notes ("added 2 commits") are never part of a thread.
 *
 * The API address comes from the merge request link itself, as in
 * mr-describe.cjs, and the key is the user's GITLAB_TOKEN from the same
 * lookup. The key is sent only as a request header and never printed.
 *
 * Node builtins only, plus ../confluence-attach.cjs for the HTTP layer.
 */

const { httpsTransport } = require('../confluence-attach.cjs');
const { mrParts } = require('../mr-describe.cjs');

const MARKER = '<!-- aidlc-turbo:review-fix -->';
const MAX_PAGES = 10;

const endpoint = (parts, rest) =>
    `${parts.api}/projects/${encodeURIComponent(parts.project)}/merge_requests/${parts.iid}/${rest}`;

/** The thread as review-fix.cjs prints it, or null when it is not open. Pure. */
function openThread(discussion, mrUrl) {
    const notes = (discussion.notes || []).filter((n) => !n.system);
    if (!notes.length) return null;
    const last = notes[notes.length - 1];
    if (String(last.body || '').includes(MARKER)) return null;
    const resolvable = notes.filter((n) => n.resolvable);
    if (resolvable.length && resolvable.every((n) => n.resolved)) return null;
    const first = notes[0];
    const pos = first.position || {};
    return {
        mr: mrUrl,
        discussion: String(discussion.id),
        file: pos.new_path || pos.old_path || null,
        line: pos.new_line || pos.old_line || null,
        url: `${mrUrl}#note_${first.id}`,
        notes: notes.map((n) => ({
            author: n.author ? (n.author.name || n.author.username || '') : '',
            body: String(n.body || '').split(MARKER).join('').trim(),
            at: n.created_at || null,
        })),
    };
}

/**
 * Every open thread of one merge request: { ok, state, threads } or { ok:
 * false, detail }. A merge request that is merged or closed has none: its
 * branch is done with.
 */
async function fetchThreads(url, { token, transport = httpsTransport }) {
    const parts = mrParts(url);
    if (!parts) return { ok: false, detail: `not a GitLab merge request link: ${url}` };
    const threads = [];
    try {
        const mr = await transport({ method: 'GET', url: endpoint(parts, '').replace(/\/$/, ''), headers: { 'PRIVATE-TOKEN': token } });
        if (mr.status < 200 || mr.status >= 300) return { ok: false, detail: `GitLab answered HTTP ${mr.status} for ${url}` };
        const state = JSON.parse(String(mr.body || '{}')).state || 'opened';
        if (state !== 'opened') return { ok: true, state, threads };
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const res = await transport({
                method: 'GET',
                url: endpoint(parts, `discussions?per_page=100&page=${page}`),
                headers: { 'PRIVATE-TOKEN': token },
            });
            if (res.status < 200 || res.status >= 300) return { ok: false, detail: `GitLab answered HTTP ${res.status} for ${url}` };
            const list = JSON.parse(String(res.body || '[]'));
            for (const d of list) {
                const open = openThread(d, url);
                if (open) threads.push(open);
            }
            const next = res.headers && res.headers['x-next-page'];
            if (!next || list.length < 100) break;
        }
    } catch (error) {
        return { ok: false, detail: String(error.message || error).split(token).join('***') };
    }
    return { ok: true, state: 'opened', threads };
}

/** Post `text` as a reply in one thread, with the marker. { ok, url } or { ok: false, detail }. */
async function replyThread(url, discussion, text, { token, transport = httpsTransport }) {
    const parts = mrParts(url);
    if (!parts) return { ok: false, detail: `not a GitLab merge request link: ${url}` };
    if (!String(text || '').trim()) return { ok: false, detail: 'the reply is empty' };
    try {
        const res = await transport({
            method: 'POST',
            url: endpoint(parts, `discussions/${encodeURIComponent(discussion)}/notes`),
            headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ body: `${String(text).trim()}\n\n${MARKER}` })),
        });
        if (res.status < 200 || res.status >= 300) return { ok: false, detail: `GitLab answered HTTP ${res.status}` };
        const note = JSON.parse(String(res.body || '{}'));
        return { ok: true, url: note.id ? `${url}#note_${note.id}` : url };
    } catch (error) {
        return { ok: false, detail: String(error.message || error).split(token).join('***') };
    }
}

module.exports = { MARKER, openThread, fetchThreads, replyThread };

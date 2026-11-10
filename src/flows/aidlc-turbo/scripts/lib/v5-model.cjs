/**
 * specsmd AI-DLC Turbo - the v5 overview model, built from an intent's records.
 *
 * v5Model(root, intent, phase?, opts?) reads one intent (from paths.findIntent)
 * and returns the model the v5 page kit reads as window.C4.model, the C4 model
 * tab of the overview (lib/overview-page.cjs withEmbed):
 *
 *   title, phase, lang         the intent's title, the phase and the language
 *                              of the record (lib/lang.cjs languageOf): the
 *                              page's texts are in it
 *   plan                       true after the build while a change the user
 *                              asked for is planned and not built yet
 *                              (opts.plan): the drawings show the plan, no
 *                              marks of the build; left out otherwise
 *   intentBranch               the brief's branch, null without one
 *   stories                    [{ id, n, title, short, what? }] the stories as
 *                              planned, `what` their plain text
 *   parts, links               the scaffold half: the Code Scaffold of
 *                              lib/design-model.cjs, below
 *   persons, systems, containers, components, outside, views
 *                              the C4 half, lib/v5-c4.cjs, from the block below
 *
 * The scaffold half, one for one from designModel():
 *   parts[id]    { id, name, kind, sub, status, path, what, near, stories,
 *                  layer, module, lines }, every part with a layer; `near` the
 *                  names of the parts without a layer that sit near it (its
 *                  test, its fix script), which are not drawn
 *   links        [{ id, from, to, kind, label, code, step, intent, stories }],
 *                  `intent` when an end is new or changed, `stories` the ones
 *                  whose drawing walks it, else null
 *
 * The C4 block of the record, technical_design.c4 (texts in the record's
 * language; ids unique over the four element lists, no @):
 *
 *   persons:    [{ id, name, desc }]
 *   systems:    [{ id, name, kind?, ext?, status?, tech?, desc, stories? }]
 *   containers: [{ id, name, system?, kind?, status?, tech, desc, zoom?, stories? }]
 *   components: [{ id, name, container, tech, desc, icon?, status?, parts, stories? }]
 *   edges:      [{ from, to, label, tech?, intent?, ends? }]
 *   outside:    { <part id>: <system id> }
 *
 *   kind       system | db for a system, container | db for a container
 *   ext        true for a system outside the application (status existing)
 *   status     new | changed | existing; left out, it follows from what the
 *              element holds: all new is new, all existing is existing,
 *              anything else changed
 *   system     the system a container belongs to; may be left out when the
 *              block has one system without ext
 *   container  the container a component belongs to (the model's `c`)
 *   zoom       the key of the container's component view; its id when left out
 *   parts      the ids of the Code Scaffold parts (with a layer) it holds
 *   stories    only where they do not follow from the parts: a component's
 *              stories are its parts' stories, a container's its components',
 *              a system's its containers'
 *   edges      between any two elements: who uses what, what calls what. A view
 *              draws each at its own level; the Code Scaffold's calls between
 *              parts of two components come with them. `label` a few words,
 *              `tech` how (SQL, REST), `intent` true when the intent adds or
 *              changes it, `ends` true when it stops with the intent
 *   outside    an external part of the Code Scaffold -> the system it stands for
 *
 * The plain texts, also record data: intent.plain, three to five sentences on
 * what the intent does in the words of the people who use it, and each
 * story's plain, what it builds and how it serves the intent. The page shows a
 * story's under its title (the overview's Details switch).
 *
 * Nothing is filled in. A record without the C4 block has no C4 elements and
 * no views, one without a plain text no story `what`, a part without a layer
 * is not drawn. lib/v5-missing.cjs names every such gap.
 *
 * The build half is added after the build, not here: the stories' merge facts
 * (files, tests, commits, first, merged, branch, mr, url), the deviations and
 * each drawn part's build. The seam is opts.afterBuild(model, ctx), called
 * last with the model and what it was read from: ctx { root, intent, record,
 * brief, raw, phase, status, title, design, plan, table }, `raw` the stories
 * of lib/overview-read.cjs, `design` the designModel() (null without a
 * drawing) and `table` the record's string table.
 *
 * This library computes data, never geometry: the kit measures and lays out.
 * Node builtins only, plus the flow's own libraries named below.
 */

'use strict';

const lang = require('./lang.cjs');
const { designModel } = require('./design-model.cjs');
const { readYaml, readBrief, readStories, field } = require('./overview-read.cjs');
const { present, plain } = require('./overview-text.cjs');
const { c4Of } = require('./v5-c4.cjs');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Everything the model is read from, for one intent from paths.findIntent: the
 * record, the brief, the phase (construction once the brief is building or done,
 * unless `phaseArg` says), the title and the stories (lib/overview-read.cjs).
 */
function readIntent(root, intent, phaseArg) {
    const record = readYaml(intent.record) || {};
    const brief = readBrief(intent);
    const status = String(brief.data.status || 'draft');
    const phase = phaseArg || (status === 'done' || status === 'building' ? 'construction' : 'inception');
    const recIntent = isObj(record.intent) ? record.intent : {};
    const title = plain(brief.data.title || recIntent.title || intent.slug);
    return { root, intent, record, brief, status, phase, title, raw: readStories(intent, record) };
}

/** The stories as the panels and the cards name them: number, title, short name and plain text. */
function storiesOf(raw) {
    return raw.map((s, i) => {
        const title = plain(field(s, 'title') || s.slug);
        const what = plain(s.rec && s.rec.plain);
        return { id: s.id, n: i + 1, title, short: plain(s.rec && s.rec.short) || title, ...(what ? { what } : {}) };
    });
}

/** The scaffold half from a designModel(), or empty without a drawing. */
function scaffoldOf(design) {
    const parts = {};
    if (!design) return { parts, links: [] };
    const near = new Map();
    for (const p of design.parts) {
        if (p.layer || !p.near) continue;
        near.set(p.near, [...(near.get(p.near) || []), p.name || p.id]);
    }
    for (const p of design.parts) {
        if (!p.layer || !p.id) continue;
        parts[p.id] = {
            id: p.id,
            name: p.name,
            kind: p.kind,
            sub: p.sub,
            status: p.status,
            path: p.path,
            what: p.what,
            near: near.get(p.id) || [],
            stories: p.stories,
            layer: p.layer,
            module: p.module,
            lines: p.lines,
        };
    }
    const walks = new Map();
    for (const s of design.stories) for (const id of s.links) walks.set(id, [...(walks.get(id) || []), s.id]);
    const links = design.links.filter((l) => parts[l.from] && parts[l.to]).map((l) => ({
        id: l.id,
        from: l.from,
        to: l.to,
        kind: l.kind,
        label: l.label,
        code: l.code,
        step: l.step,
        intent: parts[l.from].status !== 'existing' || parts[l.to].status !== 'existing',
        stories: walks.get(l.id) || null,
    }));
    return { parts, links };
}

/**
 * The v5 model of one intent. `phase` inception | construction, else from the
 * brief's status; opts.afterBuild(model, ctx) is the build half's seam;
 * opts.plan after the build: a change is open, the drawings show the plan.
 */
function v5Model(root, intent, phase, opts = {}) {
    const ctx = readIntent(root, intent, phase);
    const table = lang.forRecord(ctx.record, root);
    const design = designModel(ctx.record, { built: ctx.phase === 'construction', table });
    const scaffold = scaffoldOf(design);
    const b = ctx.brief.data;
    const model = {
        title: ctx.title,
        phase: ctx.phase,
        lang: table.lang,
        intentBranch: present(b.branch) ? String(b.branch) : null,
        stories: storiesOf(ctx.raw),
        ...scaffold,
        ...c4Of(ctx.record, scaffold, table),
    };
    const plan = !!opts.plan && ctx.phase === 'construction';
    if (plan) model.plan = true;
    if (typeof opts.afterBuild === 'function') opts.afterBuild(model, { ...ctx, design, plan, table });
    return model;
}

module.exports = { v5Model, readIntent, scaffoldOf };

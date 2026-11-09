/**
 * specsmd AI-DLC Turbo - the Code Scaffold as markdown, for render-specs.
 *
 * briefSection(record) is the `### Code Scaffold` that closes the brief's
 * `## Technical design`: the summary, one `####` heading per lane with its
 * modules and their parts (parts without a module after them), then
 * `#### Links`. Each part gives its name, kind, status, path:lines and what it
 * is, then the example it follows, a deliberate deviation, its right, its
 * source, an open choice and the confidence with its reasons. Each link ends
 * in its proof in the code (`proof file:lines`) and what the change to the
 * callee adds (`adds: ...`), when it has them.
 *
 * storySection(record, story) is the `### Code Scaffold` in the story's
 * `## For the agent`, after `### Design`: the story's summary, `#### Builds`
 * (per part or module the story's own words, the example to follow and a
 * deliberate deviation), `#### Uses` and `#### Links` between those. A new
 * part or module that a story it waits for (depends_on, all the way down)
 * already builds is there when this story starts: it builds it as changed,
 * "new in story 001", without the example, the deviation or the
 * registration, which belong to the story that made it. A changed one loses
 * them too, and a new one it only uses names the story that made it.
 *
 * Both return '' without a drawing. Pure and deterministic: render-specs.cjs
 * --check compares the output with the files. Node builtins only.
 */

const { designModel } = require('./design-model.cjs');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** One line: a line break inside a value never breaks a bullet. */
const one = (v) => String(v).replace(/\s*\n\s*/g, ' ').trim();
const sentence = (s) => (/[.!?:]$/.test(s) ? s : `${s}.`);
const code = (t) => (t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``);
const at = (file, lines) => code(lines ? `${file}:${lines}` : file);

/** "**name** (kind, status, repo r) `path:lines`", a module without lines. */
function head(x, isModule, status = x.status) {
    const tags = [isModule ? 'module' : x.kind, status, x.repo ? `repo ${x.repo}` : null].filter(Boolean);
    return `**${one(x.name)}**${tags.length ? ` (${tags.join(', ')})` : ''}${x.path ? ` ${at(x.path, isModule ? null : x.lines)}` : ''}`;
}

const follows = (f) => `Follows: ${at(f.file, f.lines)}${f.note ? `, ${one(f.note)}` : ''}`;

function right(r) {
    const bits = [
        r.short && sentence(one(r.short)),
        r.what && sentence(one(r.what)),
        r.file && `In ${at(r.file, r.lines)}.`,
        r.decision && `Decision: ${r.decision}.`,
    ].filter(Boolean);
    return `Right${r.status ? ` (${r.status})` : ''}: ${bits.join(' ')}`;
}

/** The notes under a module; a later story has none, its first one made it. */
function moduleNotes(m, later) {
    const out = [];
    if (later) return out;
    if (m.follows) out.push(follows(m.follows));
    if (m.registered_in.length) out.push(`Registered in: ${m.registered_in.map((r) => at(r.file, r.lines)).join(', ')}`);
    return out;
}

/**
 * The notes under a part; the brief adds the source, an open choice and the
 * confidence. A later story leaves out the example and the deviation.
 */
function partNotes(p, brief, later) {
    const out = [];
    if (p.extends) out.push(`Extends: ${one(p.extends)}`);
    if (p.implements) out.push(`Implements: ${one(p.implements)}`);
    if (p.follows && !later) out.push(follows(p.follows));
    if (p.deviates && !later) out.push(`Deviates: ${one(p.deviates)}`);
    if (p.right) out.push(right(p.right));
    if (!brief) return out;
    if (p.source) out.push(`Source: ${p.source}`);
    if (p.open) out.push(`Open choice: ${[p.open, p.open_detail].filter(Boolean).map(one).join(' ')}`);
    out.push(`Confidence: ${p.confidence.level}. ${p.confidence.reasons.map((r) => sentence(one(r))).join(' ')}`);
    return out;
}

/** A bullet with its notes one level deeper, at an indent. */
function bullet(line, notes, pad = '') {
    return [`${pad}- ${line}`, ...notes.map((n) => `${pad}  - ${n}`)].join('\n');
}

const what = (v) => (v ? `: ${one(v)}` : '');

/** ", proof `file:lines` (note)" and ", adds: what", each when the link has it. */
function proof(l) {
    const p = l.proof ? `, proof ${at(l.proof.file, l.proof.lines)}${l.proof.note ? ` (${one(l.proof.note)})` : ''}` : '';
    return `${p}${l.adds ? `, adds: ${one(l.adds)}` : ''}`;
}

function linkLines(links, model) {
    const name = (id) => {
        const p = model.parts.find((x) => x.id === id);
        return `**${p ? one(p.name) : id}**`;
    };
    return links.map((l) => `- ${name(l.from)} -> ${name(l.to)}${l.kind === 'builds_on' ? ' (builds on)' : ''}`
        + `${l.label ? `: ${one(l.label)}` : ''}${l.code ? ` ${code(l.code)}` : ''}${proof(l)}`).join('\n');
}

const summary = (v) => v.replace(/[ \t]+$/gm, '');

/** A story id as the story files name it: "3" and "003" are "003". */
const storyId = (v) => {
    const s = String(v).trim();
    return /^\d+$/.test(s) ? s.padStart(3, '0') : s;
};

/** Per story id, every story it waits for, through depends_on all the way down. */
function waitsFor(record) {
    const deps = new Map((Array.isArray(record.stories) ? record.stories : []).filter(isObj)
        .map((s) => [storyId(s.id), (Array.isArray(s.depends_on) ? s.depends_on : []).map(storyId)]));
    const memo = new Map();
    const walk = (id) => {
        if (memo.has(id)) return memo.get(id);
        const all = new Set();
        memo.set(id, all);
        for (const d of deps.get(id) || []) {
            all.add(d);
            for (const x of walk(d)) all.add(x);
        }
        return all;
    };
    return walk;
}

function briefSection(record, table) {
    const model = designModel(record, { table });
    if (!model) return '';
    const modules = new Map(model.modules.map((m) => [m.id, m]));
    const out = ['### Code Scaffold'];
    if (model.summary) out.push(summary(model.summary));
    for (const lane of model.lanes) {
        const items = [];
        for (const frame of model.frames.filter((f) => f.layer === lane.id)) {
            const m = modules.get(frame.module);
            items.push(bullet(head(m, true) + what(m.what), moduleNotes(m)));
            model.parts.filter((p) => p.module === m.id && p.layer === lane.id)
                .forEach((p) => items.push(bullet(head(p) + what(p.what), partNotes(p, true), '  ')));
        }
        model.parts.filter((p) => p.layer === lane.id && !modules.has(p.module))
            .forEach((p) => items.push(bullet(head(p) + what(p.what), partNotes(p, true))));
        out.push(`#### ${lane.name}`, items.join('\n'));
    }
    if (model.links.length) out.push('#### Links', linkLines(model.links, model));
    if (out.length === 1) out.push('None.');
    return out.join('\n\n');
}

function storySection(record, story, table) {
    const model = designModel(record, { table });
    if (!model || !isObj(story) || !isObj(story.drawing)) return '';
    const id = story.id === undefined || story.id === null ? '' : String(story.id).trim();
    const ms = model.stories.find((s) => s.id === id);
    if (!ms) return '';
    const find = (key) => {
        const p = model.parts.find((x) => x.id === key);
        return p ? { x: p, isModule: false } : { x: model.modules.find((x) => x.id === key), isModule: true };
    };
    const waits = waitsFor(record);
    const before = waits(storyId(id));
    /** The story that made x before this one: one it waits for that builds x and itself waits for none that does. */
    const madeIn = (x) => {
        const earlier = x.stories.map(storyId).filter((t) => before.has(t));
        return earlier.find((t) => !earlier.some((u) => waits(t).has(u))) || null;
    };
    const out = ['### Code Scaffold'];
    if (ms.summary) out.push(summary(ms.summary));
    const builds = Object.entries(ms.builds).map(([key, words]) => {
        const { x, isModule } = find(key);
        if (!x) return `- **${key}**${what(words)}`;
        const made = madeIn(x);
        const status = made && x.status === 'new' ? `changed, new in story ${made}` : x.status;
        return bullet(head(x, isModule, status) + what(words), isModule ? moduleNotes(x, !!made) : partNotes(x, false, !!made));
    });
    if (builds.length) out.push('#### Builds', builds.join('\n'));
    const uses = ms.uses.map((key) => {
        const { x, isModule } = find(key);
        if (!x) return `- **${key}**`;
        const made = x.status === 'new' && madeIn(x);
        return `- ${head(x, isModule, made ? `new in story ${made}` : x.status)}${what(x.what)}`;
    });
    if (uses.length) out.push('#### Uses', uses.join('\n'));
    const links = model.links.filter((l) => ms.links.includes(l.id));
    if (links.length) out.push('#### Links', linkLines(links, model));
    if (out.length === 1) out.push('None.');
    return out.join('\n\n');
}

module.exports = { briefSection, storySection };

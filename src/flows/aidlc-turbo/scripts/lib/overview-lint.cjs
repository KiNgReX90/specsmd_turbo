/**
 * specsmd AI-DLC Turbo - the overview data on the record, for spec-lint.cjs:
 * the layers, every story's short name, slice and integration tests, and the
 * lifecycle. Plus the small helpers spec-lint.cjs shares with it.
 *
 * Node builtins only, plus the story ids of ../render-specs.cjs.
 */

const render = require('../render-specs.cjs');

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const asList = (v) => (Array.isArray(v) ? v : (filled(v) ? [v] : []));

/** Every story reachable from `id` over depends_on. */
function reach(id, deps, seen = new Set()) {
    for (const d of deps.get(id) || []) {
        if (!seen.has(d)) { seen.add(d); reach(d, deps, seen); }
    }
    return seen;
}

const SLICE = ['new', 'used'];
const SHORT_MAX = 24;
const SCOPE_SHORT_MAX = 60;
const trimmed = (v) => (filled(v) ? String(v).trim() : '');
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The overview data on the record: the layers, every story's short name,
 * slice and integration tests, and the lifecycle. All of it is optional, so a
 * record without it is clean.
 */
function lintOverview(record, add) {
    const stories = asList(record.stories).filter((s) => isMap(s) && filled(s.id));
    const ids = new Set(stories.map((s) => render.storyId(s.id)));
    const deps = new Map(stories.map((s) => [render.storyId(s.id), asList(s.depends_on).map(render.storyId)]));
    const overview = isMap(record.overview) ? record.overview : {};

    asList(record.deliberately_not).forEach((n, i) => {
        const length = isMap(n) ? Array.from(trimmed(n.short)).length : 0;
        if (length > SCOPE_SHORT_MAX) add('record.yaml', 'short', `deliberately_not ${trimmed(n.id) || `[${i}]`}: short is ${length} characters, at most ${SCOPE_SHORT_MAX}: it is the chip under Out of scope on the overview page`);
    });

    const layers = new Set();
    asList(overview.layers).forEach((l, i) => {
        const id = isMap(l) ? trimmed(l.id) : '';
        if (!id) { add('record.yaml', 'layers', `overview.layers[${i}] has no id`); return; }
        if (layers.has(id)) add('record.yaml', 'layers', `overview.layers: id ${id} appears twice`);
        layers.add(id);
    });

    for (const s of stories) {
        const id = render.storyId(s.id);
        const file = filled(s.slug) ? `stories/${render.storyFile(s)}` : 'record.yaml';
        const note = (rule, message) => add(file, rule, file === 'record.yaml' ? `story ${id}: ${message}` : message);
        const length = Array.from(trimmed(s.short)).length;
        if (length > SHORT_MAX) note('short', `short is ${length} characters, at most ${SHORT_MAX}: it names the story in the pictures on the overview page`);

        if (s.slice !== undefined && s.slice !== null) {
            if (!isMap(s.slice)) note('slice', 'slice must be a map of layer id to new or used');
            else {
                for (const [layer, value] of Object.entries(s.slice)) {
                    if (!layers.has(layer)) note('slice', `slice names ${layer}, which is not a layer id in overview.layers`);
                    if (!SLICE.includes(trimmed(value))) note('slice', `slice ${layer} is "${trimmed(value)}", expected new or used`);
                }
            }
        }

        // Each test runs against the real code of the earlier story, so that story lands first.
        const reached = reach(id, deps);
        const seen = new Set();
        asList(s.integration).forEach((e, j) => {
            const at = `integration ${j + 1}`;
            if (!isMap(e)) { note('integration', `${at} is not a map: give with and test`); return; }
            if (!filled(e.with)) note('integration', `${at} has no with: name the earlier story it tests with`);
            else {
                const target = render.storyId(e.with);
                if (target === id) note('integration', `${at}: with names this story itself`);
                else if (!ids.has(target)) note('integration', `${at}: with names story ${target}, which is not a story of this intent`);
                else if (!reached.has(target)) note('integration', `${at}: with names story ${target}, which this story does not reach through depends_on: add the dependency so it lands first, or drop the test`);
                if (seen.has(target)) note('integration', `${at}: story ${target} has an integration test here already: one per earlier story`);
                seen.add(target);
            }
            if (!filled(e.test)) note('integration', `${at} has no test: the test the builder writes, in a line the overview page shows`);
        });
    }

    const life = overview.lifecycle;
    if (!isMap(life)) return;
    const flag = (message) => add('record.yaml', 'lifecycle', `overview.lifecycle: ${message}`);
    const lanes = new Set(asList(life.lanes).filter(isMap).map((l) => trimmed(l.id)).filter(Boolean));
    const steps = new Set();
    asList(life.steps).forEach((step, i) => {
        const sid = isMap(step) ? trimmed(step.id) : '';
        if (!sid) { flag(`steps[${i}] has no id`); return; }
        if (steps.has(sid)) flag(`step id ${sid} appears twice`);
        steps.add(sid);
        const lane = trimmed(step.lane);
        if (!lanes.has(lane)) flag(lane ? `step ${sid} is on lane ${lane}, which is not a lane id` : `step ${sid} has no lane`);
        asList(step.stories).map(render.storyId).filter((x) => !ids.has(x))
            .forEach((x) => flag(`step ${sid} names story ${x}, which is not a story of this intent`));
    });
    asList(life.arrows).forEach((a, i) => {
        if (!isMap(a)) { flag(`arrows[${i}] is not a map: give from and to`); return; }
        const name = `arrow ${trimmed(a.from) || '?'} -> ${trimmed(a.to) || '?'}`;
        for (const end of ['from', 'to']) {
            const v = trimmed(a[end]);
            if (!v) flag(`${name} has no ${end}`);
            else if (!steps.has(v)) flag(`${name}: ${v} is not a step id`);
        }
    });
    if (isMap(life.under_all) && filled(life.under_all.story) && !ids.has(render.storyId(life.under_all.story))) {
        flag(`under_all names story ${render.storyId(life.under_all.story)}, which is not a story of this intent`);
    }
}

module.exports = { lintOverview, reach, filled, asList };

/**
 * specsmd AI-DLC Turbo - the lines of the Code Scaffold, routed where the
 * page is made.
 *
 * Routing the lines of a large drawing takes seconds (a drawing of sixty
 * parts and a hundred and thirty links ran half a minute), and a page would
 * do it on every open and again on every flip of the switch "Only new and
 * changed". So the page that inlines the drawing brings the lines of
 * both views of that switch: designRoutes(model, phase) lays both out the
 * way the page does (templates/design: design-filter.js leaves out what
 * exists, after the build what the build did not mark) and returns the
 * lines it routed by their key, for model.routes. design-layout.js then
 * routes only what the page did not bring; a key holds the router's own
 * code, so lines from another router are never used.
 *
 * The model is read as the page reads it, through JSON. Node builtins only,
 * plus the drawing's own code.
 */

const path = require('path');

const DESIGN_DIR = path.join(__dirname, '..', '..', 'templates', 'design');
const { layout } = require(path.join(DESIGN_DIR, 'design-layout.js'));
const { only } = require(path.join(DESIGN_DIR, 'design-filter.js'));

// what the layout and the switch read of a model (lib/design-model.cjs always gives them all)
const WHOLE = ['lanes', 'modules', 'frames', 'parts', 'links', 'stories'];

/** { key: [[link id, points]] } of both views of the switch, one when it leaves nothing out; none for a design that is no whole model. */
function designRoutes(model, phase) {
    if (!model || !WHOLE.every((k) => Array.isArray(model[k]))) return {};
    const page = JSON.parse(JSON.stringify(model));
    // routed afresh, also for a model that came with lines, so every line is in what it returns
    delete page.routes;
    // what the panel (design-panel.js, design-filter.js) counts as built: only after the build, with its marks
    const built = phase === 'construction' && page.build ? page.build : null;
    const less = only(page, built);
    const keep = {};
    for (const m of less === page ? [page] : [less, page]) layout(m, { keep });
    return keep;
}

module.exports = { designRoutes };

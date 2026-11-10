/**
 * specsmd AI-DLC Turbo - the Code Scaffold drawing as a page inlines it.
 *
 * The overview page (intent-overview.cjs) inlines the drawing from templates/design:
 * its style, and its code in load order (the page's texts first, the router and the labels before
 * the layout, the engine, the shared kit, the steps, play and the
 * full-screen view, the legend, what a part does and where it deviated, the
 * details, the chips of their stories, a part's change in the code, the walk
 * between the parts, the block in an arrow's direction, the switch that
 * leaves out what exists, the handles that resize, the details panel right of the drawing, the
 * crossfade, the box of the step held over the drawing, what lights up, the room of the view on a desktop and the
 * readable zoom in it, what the
 * details show and what is chosen, what the pointer and the keys do, the Review tab (what it lists, what is viewed,
 * the list of files, the tab itself), before the panel that mounts them; the tabs of the overview after it; the
 * Maquette look and motion last, so they read after everything they dress).
 *
 * The overview's Maquette look of the page itself (pageAssets) comes on
 * every overview, also one without a drawing; it dresses only a page whose
 * body has the class mq. With it come the tabs (design-tabs.js: also the
 * two tabs of the v5 page the overview may hold) and the switches Details
 * and ? on the masthead (design-switches.js), so a page without a drawing
 * has them too. Both start with design-text.js, which reads the page's
 * string table (<script id="turbo-text">).
 *
 * Node builtins only.
 */

const fs = require('fs');
const path = require('path');

const DESIGN_DIR = path.join(__dirname, '..', '..', 'templates', 'design');
const PAGE_JS = ['design-tabs.js', 'design-switches.js', 'maquette-page.js'];
const PAGE_CSS = ['maquette.css', 'maquette-func.css'];
const TEXT_JS = ['design-text.js'];
const DESIGN_JS = [...TEXT_JS, 'design-route.js', 'design-labels.js', 'design-order.js', 'design-channel.js', 'design-fit.js', 'design-place.js', 'design-layout.js', 'design-engine.js', 'design-built.js', 'design-kit.js', 'design-steps.js', 'design-play.js', 'design-float.js', 'design-view.js', 'design-keys.js', 'design-about.js', 'design-detail.js', 'design-stories.js', 'design-diff.js', 'design-browse.js', 'design-near.js', 'design-filter.js', 'design-grip.js', 'design-pane.js', 'design-swap.js', 'design-stepbox.js', 'design-light.js', 'design-room.js', 'design-zoom.js', 'design-show.js', 'design-chosen.js', 'design-input.js', 'design-review-list.js', 'design-review-seen.js', 'design-review-filter.js', 'design-review-side.js', 'design-review.js', 'design-panel.js', ...PAGE_JS, 'maquette-draw.js'];
const DESIGN_CSS = ['design.css', 'design-scaffold.css', 'design-touch.css', 'design-steps.css', 'design-filter.css', 'design-layout.css', 'design-browse.css', 'design-about.css', 'design-diff.css', 'design-pane.css', 'design-stepbox.css', 'design-zoom.css', 'design-review.css', ...PAGE_CSS, 'maquette-draw.css', 'maquette-built.css'];
const read = (f) => fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8');

/** { css, js }: the drawing's style and its code, as one text each. */
function designAssets() {
    return { css: DESIGN_CSS.map(read).join('\n'), js: DESIGN_JS.map(read).join('\n') };
}

/** { css, js }: the look of the page, its tabs and its switches, for an overview without a drawing. */
function pageAssets() {
    return { css: PAGE_CSS.map(read).join('\n'), js: [...TEXT_JS, ...PAGE_JS].map(read).join('\n') };
}

module.exports = { DESIGN_DIR, DESIGN_JS, DESIGN_CSS, designAssets, pageAssets };

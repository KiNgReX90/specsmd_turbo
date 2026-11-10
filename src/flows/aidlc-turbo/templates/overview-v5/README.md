# The v5 page kit

The kit draws the C4 model of one intent: the system context, the containers, the
components of each container and, where the intent has a Code Scaffold, the code of each
component, zooming from level to level as C4 reads. The Turbo overview
(`templates/overview/`) shows it as its C4 model tab, in a frame (see
[Embedded in the overview](#embedded-in-the-overview)). `scripts/lib/v5-page.cjs` puts the
texts and one model between the shell and the code below and gives one HTML page;
`scripts/lib/v5-assets.cjs` serves the style and the code.

## The shell

- `00-head.html`: the document's head; `{{TITLE}}` is the window's title, `{{lang}}` the
  language of the page.
- `style.css`: the whole style, in the Turbo colours, light only.
- `body.html`: the board (the zoom path, the drawing, its tools, the legend) and the
  inspector. `{{key}}` is a text of the `v5` section of the string table.
- `tail.html`: the document's end.

## The texts

Every fixed text comes from the `v5` section of the string table
(`templates/lang/en.json`, through `scripts/lib/lang.cjs`), in the language of the record:
`v5-page.cjs` fills the `{{key}}` places of the shell, escaped, and writes the section into
`<script type="application/json" id="v5-text">`, which `00-kit.js` reads (`C4.kit.T`). A
project's own table for its language fills the same keys. The view titles come from the
same section, written into the model by `scripts/lib/v5-c4.cjs`.

## Load order

The page runs one script in this order. A later module may use what an earlier one made,
never the other way round.

1. `vendor/elk.bundled.js`: the layout engine (elkjs 0.9.3), before the module that calls
   `ELK` (`03-layout.js`).
2. `00-kit.js`: the shared tools, the texts, the icons, whether the intent is built, and the
   overview's switches as they reach the frame.
3. `01-shapes.js`, `02-build.js`, `03-layout.js`, `04-view.js`: the cards and lines, the
   marks of the build, the four levels and their layout, the drawing in its window.
4. `05-panel.js`, `06-legend.js`, `07-switches.js`, `08-path.js`, `09-input.js`: the
   inspector, the legend, Details and `?`, the zoom path, the pointer and the keys.
5. `10-app.js`: the page, which mounts all of the above and opens on the system context.
6. `11-side.js`: the inspector's frame, its grip and its fold.

## The model

`scripts/lib/v5-model.cjs` builds it and documents every field: the stories, the Code
Scaffold's parts and calls, and the C4 half (persons, systems, containers, components,
outside, views). After the build `scripts/lib/v5-model-build.cjs` adds the build: per part
its deviation from the approved Code Scaffold, which the cards and the inspector show
(`02-build.js`), and per story its commits, files, branch and merge request.

Built means the page is made at the construction (`phase: construction`) or every story is
merged. The words of the page follow it: built in the past, before the build what will
come. `plan: true` on a built page means a change the user asked for at finish is planned
and not built yet: the drawings show the plan, without the marks of the build.

The kit knows no id of its own. The intent's own system is the system without `ext` (with
several, the one the containers view draws), named "the system" when the model names none:
its card zooms into the containers. A container zooms into its own view, the one under its
`zoom` key, else under its id; a component view zooms out to the containers with its
container chosen, the containers to the system context with the own system chosen. A
component zooms into its code. A story is a number (`001`, shown as 1).

## Embedded in the overview

`scripts/lib/overview-page.cjs` `withEmbed` stores the whole page, its model with
`embed: true`, as one JSON string in `<script type="application/json" id="v5-embed">`, every
`<` escaped, when the model has `views.context`. The first time the C4 model tab shows,
`templates/design/design-tabs.js` makes a frame whose `srcdoc` is that page with, right
after `<head>`:

```html
<script>window.C4_EMBED = {"details":true,"help":false};</script>
```

`details` and `help` are the overview's switches: Details shows a story's plain text under
its title, `?` the parts of the page that explain how to read it. After that the overview
sends every change of its switches to the frame, and once more when it has loaded:

```js
{ type: 'turbo-switches', details, help }
```

by `postMessage` to any origin; the kit takes it only from the window around it. Nothing
else crosses: no shared storage and no reaching into the other window, so it works from a
file, in a sandboxed artifact and as an attachment. The frame keeps no address and nothing
in the browser's storage.

## Rules

Every module stays under 500 lines and holds no long dash. `vendor/` holds vendored
third-party code (see `vendor/README.md`) and is left out of those rules by name.

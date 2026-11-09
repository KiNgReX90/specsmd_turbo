/* The overview's two switches, as they reach this frame (00-kit.js switches): Details, on until the reader turns it
   off, shows under a story's title in every story panel what it builds and how that serves the intent (the story's
   plain text, model.stories[].what); "?" shows every part of the page that explains how to read it (class "how": the
   intro of the panel, the keys). Both follow the overview's messages; the switches themselves live on the overview. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, switches } = C4.kit;
  const said = new Map((C4.model.stories || []).map((s) => [s.id, s.what]));
  const html = document.documentElement;

  function set(s) {
    html.classList.toggle('plain-off', !s.details);
    html.classList.toggle('help-on', !!s.help);
  }
  set(switches);
  switches.on(set);

  /** A story in plain words, for right under its title in a story panel; null when it has none. */
  const story = (id) => (said.get(id) ? el('p', 'plain plain-story', said.get(id)) : null);

  C4.switches = { story };
})();

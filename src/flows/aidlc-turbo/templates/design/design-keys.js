/**
 * AI-DLC Turbo - Code Scaffold, the texts around the drawing: the legend (the
 * keys to its marks) and the ask under it.
 *
 *   TdKeys.legend(model, built, touch) -> the legend
 *   TdKeys.asks(steer)                 -> "Is this wrong?" (only while the
 *                                         inception waits; the feedback command
 *                                         is in the page's footer)
 *
 * The words come from the page's string table (TdText, design.legend). The page inlines it as window.TdKeys, before the panel
 * (design-panel.js).
 */
(function (root) {
  'use strict';

  const E = () => root.TdEngine;
  const B = () => root.TdBuild;
  const { h } = root.TdKit;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  /** A text of the legend, escaped: it goes into the legend's HTML. */
  const t = (key, vars) => String(TX.t(`design.legend.${key}`, vars)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * The colours of the certainty, only before the build: there they tell the reviewer which parts to check
   * before approving. After the build the drawing has no such colour and the details no such row.
   */
  const sure = (touch) => `<div class="td-lg-g"><h3 class="td-lg-h">${t('certainty')}</h3><ul>
<li><span class="td-ico"><i class="td-zkb td-green"></i></span><span class="td-lg-t">${t('green')}</span></li>
<li><span class="td-ico"><i class="td-zkb td-orange"></i></span><span class="td-lg-t">${t('orange')}</span></li>
<li><span class="td-ico"><i class="td-zkb td-red"></i></span><span class="td-lg-t">${t('red')}</span></li>
</ul><p class="td-lg-note">${t(touch ? 'rulesTap' : 'rulesClick')}</p></div>`;

  /**
   * The keys to the drawing: in the panel beside the drawing (folded behind "Legend" over the drawing
   * when there are no steps), a column in the full-screen side panel. A mark the drawing does not
   * use ("differs", a kind of deviation at the build, the certainty after the build) is left out.
   */
  function legend(model, built, touch) {
    const deviates = model.parts.some((p) => p.deviates);
    // while a change is open the drawing is the plan: it carries no mark of the build, so the legend has none
    const plan = !!(model && model.plan);
    const states = plan ? [] : ['different', 'added', 'gone'].filter((st) => model.parts.some((p) => p.build && p.build.state === st));
    const modOff = !plan && model.modules.some((m) => m.build && m.build.state && m.build.state !== 'as_planned');
    // the status words follow the phase: the plan before the build, what happened after it (design-engine.js)
    const word = (st) => E().statusOf({ status: st }, built);
    const lg = h('div', 'td-lg');
    lg.setAttribute('role', 'group');
    lg.setAttribute('aria-label', TX.t('design.legend.title'));
    // after the build its marks come first: they are why the page is read again
    const after = built && (states.length || modOff) ? `<div class="td-lg-g"><h3 class="td-lg-h">${t('afterBuild')}</h3><ul>${B().legendItem(states, modOff)}</ul></div>` : '';
    lg.innerHTML = `${after}<div class="td-lg-g"><h3 class="td-lg-h">${t('status')}</h3><ul>
${['new', 'existing', 'changed'].map((st) => `<li><span class="td-ico"><svg class="td-si-lg" data-s="${st}" viewBox="-14 -14 28 28" aria-hidden="true"></svg></span><span class="td-lg-t">${word(st)}</span></li>`).join('\n')}
</ul></div>
${built ? '' : sure(touch)}
<div class="td-lg-g"><h3 class="td-lg-h">${t('lines')}</h3><ul>
<li><span class="td-ico"><i class="td-ln"></i></span><span class="td-lg-t">${t('does')}</span></li>
<li><span class="td-ico"><i class="td-ln td-q"></i></span><span class="td-lg-t">${t('reads')}</span></li>
<li><span class="td-ico"><i class="td-ln td-base"></i></span><span class="td-lg-t">${t('buildsOn')}</span></li>
</ul></div>
<div class="td-lg-g"><h3 class="td-lg-h">${t('more')}</h3><ul>
<li><span class="td-ico"><i class="td-sw-mods"><b class="td-mc0"></b><b class="td-mc1"></b><b class="td-mc2"></b></i></span><span class="td-lg-t">${t('module')}</span></li>
<li><span class="td-ico"><i class="td-num">2</i></span><span class="td-lg-t">${t('chosen')}</span></li>
${deviates ? `<li><span class="td-ico td-wide"><i class="td-pa">${t('differs')}</i></span><span class="td-lg-t">${t('differsLong')}</span></li>` : ''}
</ul></div>`;
    for (const sv of lg.querySelectorAll('.td-si-lg')) E().statusIcon(sv, 0, 0, sv.dataset.s, '');
    // beside its words in the legend: no tooltip of its own
    for (const sv of lg.querySelectorAll('.td-bi-lg')) E().buildIcon(sv, 0, 0, sv.dataset.s, '');
    return lg;
  }

  /** "Is this wrong?" under the drawing, only while the inception waits (else empty, and hidden). */
  function asks(steer) {
    const w = h('div', 'td-st-wrap');
    const a = (key) => t(`asks.${key}`);
    w.innerHTML = steer ? `<div class="td-steer"><h3 class="td-st-h">${a('title')}</h3><ol class="td-st-steps">
<li>${a('choose')} <b>${a('option')}</b>.</li>
<li>${a('say')}</li>
<li>${a('redraw')}</li>
</ol></div>` : '';
    return w;
  }

  root.TdKeys = { legend, asks };
})(typeof globalThis !== 'undefined' ? globalThis : this);

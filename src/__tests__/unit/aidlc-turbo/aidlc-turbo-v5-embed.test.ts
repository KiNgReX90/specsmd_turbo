/**
 * Unit tests for the v5 page kit in the overview's frame (templates/overview-v5, README "Embedded in the overview"):
 * the overview sets window.C4_EMBED ({ details, help }) before the kit runs and later sends
 * { type: 'turbo-switches', details, help } from the window around the frame. Then:
 * - Details and ? stand as C4_EMBED says; without it Details is on and ? off;
 * - a message from the window around changes them, only the switch it names and only to true or false; a message
 *   from another window, of another type or without data changes nothing;
 * - the browser's storage, the address and the history are never touched (the frame may have no origin of its own);
 * - the page opens on the system context.
 */

import { describe, it, expect } from 'vitest';
import { clone, BUILT, boot, until } from './aidlc-turbo-v5-boot';

/** A model as the overview embeds it (lib/overview-page.cjs embedModel). */
const embedded = () => ({ ...clone(BUILT), embed: true });
/** The window around the frame: its C4_EMBED, the listeners the page adds, a storage, an address and a history
 *  that count every touch. */
function around(set?: object) {
  const parent = { name: 'the overview' };
  const heard: Record<string, ((ev: any) => void)[]> = {};
  let touched = 0;
  const count = () => { touched += 1; };
  const storage = { getItem: () => { count(); return null; }, setItem: count, removeItem: count };
  const globals: any = {
    parent,
    addEventListener: (t: string, fn: (ev: any) => void) => { (heard[t] ||= []).push(fn); },
    get localStorage() { count(); return storage; },
    get sessionStorage() { count(); return storage; },
    get location() { count(); return { hash: '' }; },
    get history() { count(); return { pushState: count, replaceState: count }; },
  };
  if (set) globals.C4_EMBED = set;
  const say = (data: unknown, source: unknown = parent) => (heard.message || []).forEach((fn) => fn({ data, source }));
  return { globals, say, touched: () => touched };
}
const classes = (ctx: any) => ['plain-off', 'help-on'].map((c) => ctx.document.documentElement.classList.contains(c));

describe('aidlc-turbo v5 kit: the overview\'s switches reach the frame', () => {
  it('Details and ? stand as C4_EMBED says', () => {
    expect(classes(boot(embedded(), { globals: around({ details: true, help: false }).globals }).ctx)).toEqual([false, false]);
    expect(classes(boot(embedded(), { globals: around({ details: false, help: true }).globals }).ctx)).toEqual([true, true]);
  });

  it('without C4_EMBED, Details is on and ? is off', () => {
    const { ctx, C4 } = boot(embedded(), { globals: around().globals });
    expect(classes(ctx)).toEqual([false, false]);
    expect(C4.kit.switches.details).toBe(true);
    expect(C4.kit.switches.help).toBe(false);
  });

  it('a message from the window around changes them; another window or another message does not', () => {
    const w = around({ details: false, help: true });
    const { ctx } = boot(embedded(), { globals: w.globals });
    w.say({ type: 'turbo-switches', details: true, help: false });
    expect(classes(ctx)).toEqual([false, false]);
    w.say({ type: 'turbo-switches', details: false, help: true }, { name: 'another window' });
    w.say({ type: 'something else', details: false, help: true });
    w.say(null);
    expect(classes(ctx)).toEqual([false, false]);
    // only the switch the message names, and only to true or false
    w.say({ type: 'turbo-switches', help: true });
    expect(classes(ctx)).toEqual([false, true]);
    w.say({ type: 'turbo-switches', details: 'no', help: 0 });
    expect(classes(ctx)).toEqual([false, true]);
  });

  it('a page that is no frame hears no message: it has no window around it', () => {
    const w = around({ details: true, help: false });
    const g = w.globals;
    Object.defineProperty(g, 'parent', { get: () => undefined });
    const { ctx } = boot(embedded(), { globals: g });
    w.say({ type: 'turbo-switches', details: false, help: true }, undefined);
    expect(classes(ctx)).toEqual([false, false]);
  });

  it('never touches the browser storage, the address or the history, also not when the switches change', async () => {
    const w = around({ details: true, help: false });
    const { C4 } = boot(embedded(), { globals: w.globals, timers: true, start: true });
    await until(() => !!C4.app.cur());
    await C4.app.zoomInto('s-shop');
    w.say({ type: 'turbo-switches', details: false, help: true });
    w.say({ type: 'turbo-switches', details: true, help: false });
    expect(w.touched()).toBe(0);
  });

  it('opens on the system context, nothing chosen', async () => {
    const { C4, byId } = boot(embedded(), { globals: around({ details: true, help: false }).globals, timers: true, start: true });
    await until(() => !!C4.app.cur());
    expect(C4.app.state()).toMatchObject({ key: 'context', sel: null, story: null });
    expect(String(byId('vtitle').textContent)).toBe(BUILT.views.context.title);
  });
});

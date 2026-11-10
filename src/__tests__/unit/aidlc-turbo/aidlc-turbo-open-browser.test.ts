/**
 * Unit tests for open-browser.cjs of the AI-DLC Turbo flow: the overview's
 * artifact link, or its file, opens in the default browser.
 * - the command per platform, for a link and for a file (made absolute);
 * - a link with a shell character, or another scheme, is refused, so nothing
 *   reaches cmd on Windows;
 * - the CLI refuses without a target or with a refused one, and starts nothing.
 * No test starts a browser.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { commandFor, isLink } = req(path.join(FLOW, 'scripts/lib/open-browser.cjs'));
const cli = req(path.join(FLOW, 'scripts/open-browser.cjs'));

const ART = 'https://claude.ai/code/artifact/0b1c-22';

afterEach(() => vi.restoreAllMocks());

describe('aidlc-turbo open-browser', () => {
  it('opens a link with the opener of each platform', () => {
    expect(commandFor(ART, 'linux')).toEqual({ cmd: 'xdg-open', args: [ART] });
    expect(commandFor(ART, 'darwin')).toEqual({ cmd: 'open', args: [ART] });
    expect(commandFor(ART, 'win32')).toEqual({ cmd: 'cmd', args: ['/c', 'start', '""', ART] });
  });

  it('opens a file by its absolute path', () => {
    const file = 'docs/x/overview.html';
    expect(commandFor(file, 'linux')).toEqual({ cmd: 'xdg-open', args: [path.resolve(file)] });
  });

  it('refuses a link with a shell character or another scheme, and an empty target', () => {
    for (const bad of [`${ART}&calc`, `${ART}|x`, `${ART} x`, 'javascript://x', 'file://etc/passwd', '', '  ']) {
      expect(commandFor(bad, 'win32'), bad).toBeNull();
    }
    expect(isLink(ART)).toBe(true);
    expect(isLink('http://127.0.0.1:8732/overview.html')).toBe(true);
    expect(isLink('docs/x/overview.html')).toBe(false);
  });

  it('the CLI refuses without a target or with a refused one', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(cli.main([])).toBe(1);
    expect(err.mock.calls[0][0]).toMatch(/^Usage: /);
    expect(cli.main(['javascript://x'])).toBe(1);
    expect(err.mock.calls[1][0]).toBe('Not opened: javascript://x is no http or https link and no file');
  });
});

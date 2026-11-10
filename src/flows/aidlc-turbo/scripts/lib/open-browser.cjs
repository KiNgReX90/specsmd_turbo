/**
 * specsmd AI-DLC Turbo - open a page in the default browser.
 *
 * commandFor(target, platform) is the command that opens it: `open` on macOS,
 * `cmd /c start "" ...` on Windows, `xdg-open` elsewhere. A target is a web
 * link (http or https, no space, quote or shell character, since Windows
 * reads it through cmd) or a file, made absolute. Anything else: null.
 *
 * openInBrowser(target) starts that command detached, without waiting, and
 * says whether it could start it.
 *
 * Node builtins only.
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const LINK = /^https?:\/\/[^\s"'<>|&^%`]+$/i;

/** Whether the target is a web link the opener takes. */
const isLink = (target) => LINK.test(String(target || ''));

/** { cmd, args } that open the target on that platform, or null when it is no link and no path. */
function commandFor(target, platform = process.platform) {
    const t = String(target || '').trim();
    if (!t) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !isLink(t)) return null;
    const where = isLink(t) ? t : path.resolve(t);
    if (platform === 'darwin') return { cmd: 'open', args: [where] };
    if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', where] };
    return { cmd: 'xdg-open', args: [where] };
}

/** Open the target in the default browser, detached; false when it could not be started. */
function openInBrowser(target) {
    const c = commandFor(target);
    if (!c) return false;
    try {
        const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        return true;
    } catch {
        return false;
    }
}

module.exports = { commandFor, openInBrowser, isLink };

#!/usr/bin/env node
/**
 * specsmd AI-DLC Turbo - open the overview in the default browser.
 *
 * The inception and the finish publish the overview as a claude.ai artifact
 * and open its link here, so the user sees it in the browser and not only in
 * the host. A path to a file opens that file.
 *
 *   node .specsmd/aidlc-turbo/scripts/open-browser.cjs <link or file>
 *
 * Prints `Opened: <target>` and exits 0, or names why not and exits 1: the
 * agent then names the link or the path to the user.
 *
 * Node builtins only, plus ./lib/open-browser.cjs.
 */

'use strict';

const { commandFor, openInBrowser } = require('./lib/open-browser.cjs');

const USAGE = 'Usage: node .specsmd/aidlc-turbo/scripts/open-browser.cjs <link or file>';

function main(argv) {
    const target = argv.find((a) => !a.startsWith('--'));
    if (!target || argv.includes('--help')) {
        console.error(USAGE);
        return target ? 0 : 1;
    }
    if (!commandFor(target)) {
        console.error(`Not opened: ${target} is no http or https link and no file`);
        return 1;
    }
    if (!openInBrowser(target)) {
        console.error(`Not opened: no browser could be started for ${target}`);
        return 1;
    }
    console.log(`Opened: ${target}`);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };

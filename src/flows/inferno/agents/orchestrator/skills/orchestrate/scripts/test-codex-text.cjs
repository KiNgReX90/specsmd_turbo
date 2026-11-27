'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A test that checks a Codex skill's text reads it from the flow source in this repository, and from where the
// installer writes it in a host: `codex/skills/<skill>/` here, `.agents/skills/<skill>/` under the host root
// there. The flow is installed at `<host>/.specsmd/inferno`, so the host root is two folders above the flow.

const FLOW = path.resolve(__dirname, '../../../../..');
const HOST = path.resolve(FLOW, '../..');

/** The path of a file of a Codex skill, from the flow source when it is there and from the install otherwise. */
function codexSkillFile(skill, rel) {
  const source = path.join(FLOW, 'codex', 'skills', skill, rel);
  if (fs.existsSync(source)) return source;
  const installed = path.join(HOST, '.agents', 'skills', skill, rel);
  if (fs.existsSync(installed)) return installed;
  throw new Error(`the Codex skill file ${skill}/${rel} is neither in the flow source at ${source} ` +
    `nor where the installer writes it at ${installed}`);
}

module.exports = { codexSkillFile };

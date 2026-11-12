'use strict';

/** The paths of this repository the planner A/B eval reads. */

const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const SRC = path.join(REPO, 'src');
const S = path.join(SRC, 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const CONSUMER = path.join(__dirname, 'consumer');
const STATEMENT = path.join(__dirname, 'statement.md');

module.exports = { REPO, SRC, S, CONSUMER, STATEMENT };

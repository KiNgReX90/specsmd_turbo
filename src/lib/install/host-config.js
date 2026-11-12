const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { LANES } = require('../../flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs');

/** The host's .specs-<flow>/config.yaml as data, or {} when the host has none. */
function hostConfig(root, flowKey) {
    const abs = path.join(root, `.specs-${flowKey}`, 'config.yaml');
    if (!fs.existsSync(abs)) return {};
    return yaml.load(fs.readFileSync(abs, 'utf8')) || {};
}

/**
 * The line the install prints for an INFERNO host whose config has no `mutate` block, or null.
 * The two keys change what a mutant's test sees, and nothing else tells a host they exist: a host
 * without `mutate.sealed` reseals inside its test command, and that seal stays changed afterwards.
 */
function mutateLine(root, flowKey) {
    if (flowKey !== 'inferno' || Object.prototype.hasOwnProperty.call(hostConfig(root, flowKey), 'mutate')) return null;
    return '.specs-inferno/config.yaml has no mutate block. mutate.sealed: the files your tests check against a seal, ' +
        'with the command that reseals them, so a mutant in one is resealed before its test and put back after. ' +
        'mutate.session: the wrapper your tests run through on another machine, so a batch of mutants shares one session. ' +
        'Both are in .specsmd/inferno/agents/orchestrator/config.example.yaml.';
}

/**
 * The line the install prints for an INFERNO host whose config sets a lane with no `verdicts` key,
 * or null. Without the key a product red of that lane has no accept, even one the lane itself
 * proved intermittent, and nothing else tells a host the key exists.
 */
function verdictsLine(root, flowKey) {
    if (flowKey !== 'inferno') return null;
    const verification = hostConfig(root, flowKey).verification;
    if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return null;
    const map = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const bare = LANES.filter((lane) => map(verification[lane]) && verification[lane].verdicts === undefined);
    if (bare.length === 0) return null;
    const names = bare.map((lane) => `verification.${lane}`).join(' and ');
    return `.specs-inferno/config.yaml sets ${names} with no verdicts key. ${bare.map((lane) => `verification.${lane}.verdicts`).join(', ')}: ` +
        'the file the lane writes its red tests to on a product red, as {"red": [{"name": "<test>", "base": "green", "again": "green"}]}, ' +
        'so a red the lane walked green on the base and green again on the branch can be accepted as intermittent. ' +
        'It is in .specsmd/inferno/agents/orchestrator/config.example.yaml.';
}

module.exports = { hostConfig, mutateLine, verdictsLine };

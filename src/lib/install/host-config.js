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
 * The keys change where and how a mutant's test runs and how its red reads, and nothing else tells
 * a host they exist: a host without `mutate.sealed` reseals inside its test command, and that seal
 * stays changed afterwards; a check's red without `mutate.checks` never reads caught. A host with
 * no `mutate` block is the one whose recorded reviews wrap their tests by hand, so the line names
 * `mutate.wrapped` too: without it `mutate.run` wraps each of those a second time.
 */
function mutateLine(root, flowKey) {
    if (flowKey !== 'inferno' || Object.prototype.hasOwnProperty.call(hostConfig(root, flowKey), 'mutate')) return null;
    return '.specs-inferno/config.yaml has no mutate block. mutate.sealed: the files your tests check against a seal, ' +
        'with the command that reseals them, so a mutant in one is resealed before its test and put back after. ' +
        'mutate.session: the wrapper your tests run through on another machine, so a batch of mutants shares one session. ' +
        'mutate.run: the wrapper every mutant test runs through, with {tree} and {test}, so a reviewer writes the bare test. ' +
        'mutate.wrapped: a regex of the other ways your recorded tests already spell that wrapper, so mutate.run never wraps one twice. ' +
        'mutate.checks: your checks that print no test runner\'s summary, each with the line it prints on a finding, ' +
        'so a red run that printed it reads caught. ' +
        'All five are in .specsmd/inferno/agents/orchestrator/config.example.yaml.';
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

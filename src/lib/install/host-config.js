const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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

module.exports = { hostConfig, mutateLine };

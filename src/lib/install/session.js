const fs = require('fs-extra');
const path = require('path');
const { lockPath } = require('./lock');

/**
 * The installed files a host CLI reads once, when a session starts. Claude Code loads
 * .claude/agents then, and a subagent spawned later in that session gets the definition it
 * loaded. Codex builds its instructions from AGENTS.md when a session starts and loads its
 * custom agents from .codex/agents with its config. A command, prompt, workflow, steering or
 * skill file of any tool is read when it is used, so a running session already gets the new text.
 */
const SESSION_START = [
    { name: 'Claude Code', reads: (rel) => rel.startsWith('.claude/agents/') },
    { name: 'Codex', reads: (rel) => rel === 'AGENTS.md' || rel.startsWith('.codex/agents/') },
];

/** True when root holds an install of this flow: the lock every install writes, readable or not. */
function installedBefore(root, flowKey) {
    return fs.pathExistsSync(path.join(root, lockPath(flowKey)));
}

/**
 * The line the install prints when it replaced an install of the same flow and wrote a file a
 * host CLI reads when a session starts, or null. `installed` is the host-relative paths it wrote.
 * A first install prints none: a session that never had the flow holds no old definition of it.
 */
function sessionLine(reinstall, installed) {
    if (!reinstall) return null;
    const written = [...installed];
    const hosts = SESSION_START.filter((host) => written.some(host.reads)).map((host) => host.name);
    if (hosts.length === 0) return null;
    return `This install replaced an existing one. A ${hosts.join(' or ')} session started before it keeps ` +
        'the agent definitions it read when it started: start a fresh session, or have the running session ' +
        're-read the installed definition before it starts its next item.';
}

module.exports = { installedBefore, sessionLine };

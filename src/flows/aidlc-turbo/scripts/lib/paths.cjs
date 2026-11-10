/**
 * specsmd AI-DLC Turbo - artifact layout.
 *
 * The one place that knows where every artifact lives. Scripts take the
 * artifact root (default `.specs-aidlc-turbo`, relative to the project root)
 * and ask this module for paths; nothing else builds artifact paths by hand.
 *
 *   repo/                       the whole repo, stays across intents
 *     config.yaml               flow settings (installer questionnaire)
 *     repo.yaml                 codebase scan and how the app runs
 *     standards/                stack, rules, architecture
 *   project/                    a series of intents
 *     project.yaml              project type, docs link, Jira board
 *     pages/                    the shared project documentation pulled from Confluence
 *     digests/                  digests of project pages, reused across intents
 *   docs/{inception}/           one inception
 *     pages/                    the original pages; builders never read them
 *     register.yaml             numbered source register (S-001, S-002, ...)
 *     sync.yaml                 Confluence and Jira sync state
 *     register-candidates/      docs-reader output, merged and deleted in intake
 *     {intent}/                 often just one per inception
 *       record.yaml             decision record, written from intake on
 *       brief.md                rendered by render-specs.cjs
 *       stories/                rendered by render-specs.cjs
 *       tests/                  manual test cases, written at finish
 *       proof/                  story-verify.cjs results, one file per story
 *       overview.html           the overview page
 *       code-scaffold.html      the overview opening on the Code Scaffold, saved after the approval
 *       code-scaffold-built.html  the same after the build, the drawing updated as built
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '.specs-aidlc-turbo';

/** Names that can never be an inception or intent slug, because they are folders of the layout. */
const RESERVED = new Set(['pages', 'digests', 'standards', 'tests', 'proof', 'stories', 'register-candidates']);

function intentPaths(dir) {
    return {
        dir,
        slug: path.basename(dir),
        inception: path.basename(path.dirname(dir)),
        record: path.join(dir, 'record.yaml'),
        brief: path.join(dir, 'brief.md'),
        stories: path.join(dir, 'stories'),
        tests: path.join(dir, 'tests'),
        proof: path.join(dir, 'proof'),
        overview: path.join(dir, 'overview.html'),
        scaffold: path.join(dir, 'code-scaffold.html'),
        scaffoldBuilt: path.join(dir, 'code-scaffold-built.html'),
    };
}

function inceptionPaths(docsDir, inception) {
    const dir = path.join(docsDir, inception);
    return {
        dir,
        slug: inception,
        pages: path.join(dir, 'pages'),
        register: path.join(dir, 'register.yaml'),
        sync: path.join(dir, 'sync.yaml'),
    };
}

/** Every fixed path of the layout, for one artifact root. */
function layout(root = ARTIFACT_DIR) {
    const repoDir = path.join(root, 'repo');
    const projectDir = path.join(root, 'project');
    const docs = path.join(root, 'docs');
    return {
        root,
        repoDir,
        config: path.join(repoDir, 'config.yaml'),
        repoYaml: path.join(repoDir, 'repo.yaml'),
        standards: path.join(repoDir, 'standards'),
        projectDir,
        projectYaml: path.join(projectDir, 'project.yaml'),
        projectPages: path.join(projectDir, 'pages'),
        digests: path.join(projectDir, 'digests'),
        docs,
        inception: (inception) => inceptionPaths(docs, inception),
        intent: (inception, slug) => intentPaths(path.join(docs, inception, slug)),
    };
}

function dirs(p) {
    try {
        return fs.readdirSync(p, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !RESERVED.has(d.name) && !d.name.startsWith('.'))
            .map((d) => d.name)
            .sort();
    } catch {
        return [];
    }
}

function isIntentDir(dir) {
    return fs.existsSync(path.join(dir, 'record.yaml')) || fs.existsSync(path.join(dir, 'brief.md'));
}

/** Every inception folder under docs/, sorted, also one that holds no intent yet. */
function listInceptions(root = ARTIFACT_DIR) {
    return dirs(path.join(root, 'docs'));
}

/** Every intent under docs/, across all inceptions, sorted by inception then slug. */
function listIntents(root = ARTIFACT_DIR) {
    const docs = path.join(root, 'docs');
    const out = [];
    for (const inception of dirs(docs)) {
        for (const slug of dirs(path.join(docs, inception))) {
            const dir = path.join(docs, inception, slug);
            if (isIntentDir(dir)) out.push(intentPaths(dir));
        }
    }
    return out;
}

/**
 * Find an intent by its slug. Intent slugs are unique across all inceptions,
 * so the slug alone is enough. Returns null when there is none, throws when
 * the same slug sits under two inceptions.
 */
function findIntent(root, slug) {
    const hits = listIntents(root).filter((i) => i.slug === slug);
    if (hits.length === 0) return null;
    if (hits.length > 1) {
        throw new Error(`Intent "${slug}" exists under more than one inception: ${hits.map((h) => h.dir).join(', ')}`);
    }
    return hits[0];
}

/** True when the artifact root still has the layout from before repo/, project/ and docs/. */
function isLegacy(root = ARTIFACT_DIR) {
    return ['intents', 'config.yaml', 'project.yaml', 'standards', 'digests', 'project-docs', 'tests']
        .some((name) => fs.existsSync(path.join(root, name)));
}

function legacyMessage(root = ARTIFACT_DIR) {
    return `${root} still has the old layout. Move it once with: `
        + 'node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs --write';
}

function isReservedSlug(slug) {
    return RESERVED.has(slug);
}

module.exports = {
    ARTIFACT_DIR,
    layout,
    listInceptions,
    listIntents,
    findIntent,
    isLegacy,
    legacyMessage,
    isReservedSlug,
};

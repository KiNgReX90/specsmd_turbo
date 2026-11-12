import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSandbox, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');
const { verdictsLine } = require('../../../lib/install/host-config');

// A lane's `verdicts` key reached hosts as one commented line of the config example, and a host
// whose lane set none met a product red with no step after it. The install now says it in one
// line when a configured lane of the host's config has no `verdicts` key.
describe.sequential('install verdicts hint', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;
  let logs: string[];

  beforeEach(() => {
    box = openSandbox('specsmd-verdicts-hint-');
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  const hinted = () => logs.filter((line) => line.includes('.verdicts'));
  const lane = (name: string, extra = '') => `  ${name}:\n    command: npm run ${name}\n    scope: ["src/**"]\n${extra}`;

  it('prints one line naming the key and its shape for a configured lane with no verdicts key', async () => {
    write('.specs-inferno/config.yaml', `verification:\n${lane('smoke')}`);

    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('.specs-inferno/config.yaml sets verification.smoke with no verdicts key');
    expect(hinted()[0]).toContain('verification.smoke.verdicts: the file the lane writes its red tests to on a product red');
    expect(hinted()[0]).toContain('{"red": [{"name": "<test>", "base": "green", "again": "green"}]}');
    expect(hinted()[0]).toContain('.specsmd/inferno/agents/orchestrator/config.example.yaml');
  });

  it('names every configured lane without the key in that one line, and none that sets it', async () => {
    write('.specs-inferno/config.yaml', `verification:\n${lane('smoke', '    verdicts: ../smoke-verdicts.json\n')}${lane('windows')}`);

    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('sets verification.windows with no verdicts key');
    expect(hinted()[0]).not.toContain('verification.smoke');

    write('.specs-inferno/config.yaml', `verification:\n${lane('smoke')}${lane('windows')}`);
    expect(verdictsLine(box.root, 'inferno')).toContain('sets verification.smoke and verification.windows with no verdicts key');
  });

  it('prints nothing when every configured lane sets the key', async () => {
    write('.specs-inferno/config.yaml', `verification:\n${lane('smoke', '    verdicts: ../smoke-verdicts.json\n')}`);

    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(0);
  });

  it('prints nothing for a host with no lane configured, or no config at all', async () => {
    await installFlow('inferno', ['claude']);
    expect(hinted()).toHaveLength(0);

    for (const body of ['mode: production\n', 'verification:\n  finalize:\n    - npm test\n', 'verification: []\n', 'verification:\n  smoke: npm run smoke\n']) {
      write('.specs-inferno/config.yaml', body);
      expect(verdictsLine(box.root, 'inferno')).toBeNull();
    }
  });

  it('says nothing for another flow', () => {
    write('.specs-inferno/config.yaml', `verification:\n${lane('smoke')}`);
    write('.specs-fire/config.yaml', `verification:\n${lane('smoke')}`);
    expect(verdictsLine(box.root, 'fire')).toBeNull();
    expect(verdictsLine(box.root, 'inferno')).toContain('verification.smoke.verdicts');
  });
});

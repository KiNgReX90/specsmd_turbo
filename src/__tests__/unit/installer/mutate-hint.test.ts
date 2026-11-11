import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSandbox, write } from './sandbox';

const { installFlow } = require('../../../lib/installer');
const { mutateLine } = require('../../../lib/install/host-config');

// The plan names `mutate.sealed` and `mutate.session` in prose only, and a host that reinstalled
// left both out with nothing to tell it so. The install now says it in one line when the host's
// config has no `mutate` block.
describe.sequential('install mutate hint', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;
  let logs: string[];

  beforeEach(() => {
    box = openSandbox('specsmd-mutate-hint-');
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  const hinted = () => logs.filter((line) => line.includes('mutate.sealed'));

  it('prints one line naming mutate.sealed and mutate.session for a host config with no mutate block', async () => {
    write('.specs-inferno/config.yaml', 'mode: production\n');

    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('.specs-inferno/config.yaml has no mutate block');
    expect(hinted()[0]).toContain('mutate.session');
    expect(hinted()[0]).toMatch(/mutate\.sealed: the files your tests check against a seal/);
  });

  it('prints the line for a host with no config at all', async () => {
    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(1);
  });

  it('prints nothing for a host config that has a mutate block', async () => {
    write('.specs-inferno/config.yaml', 'mutate:\n  reseal_seconds: 60\n');

    await installFlow('inferno', ['claude']);

    expect(hinted()).toHaveLength(0);
  });

  it('says nothing for another flow', () => {
    expect(mutateLine(box.root, 'fire')).toBeNull();
    expect(mutateLine(box.root, 'inferno')).toContain('mutate.session');
  });
});

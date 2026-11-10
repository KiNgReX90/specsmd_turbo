/**
 * Unit tests for lib/integration-tests.cjs, the integration test cards of the
 * overview page. Each story's `integration: [{ with, test }]` becomes one
 * card, its test in the record's language:
 * - numbered T1, T2, ... in story order; an entry without `with` is no card;
 * - the text shown as plain text;
 * - the expected outcome cut from the text: after the last colon, else the
 *   clause with the first outcome verb of the record's language
 *   (overview.outcomeWords of the string table); empty when there is no clear
 *   one, never invented;
 * - the real code it runs against: the drawing parts the text names
 *   as whole words, in the order it names them, each with the story that
 *   builds it (the earlier story first); when the text names none, the parts
 *   the earlier story builds and the later one uses (from the drawing).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { integrationTests, outcome } = req(path.join(FLOW, 'scripts/lib/integration-tests.cjs'));
const { plain } = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const lang = req(path.join(FLOW, 'scripts/lib/lang.cjs'));

const present = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
const storyId = (v: unknown) => (typeof v === 'number' ? String(v).padStart(3, '0') : String(v).trim());
const helpers = { plain, storyId, present };

const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** The drawing: a gateway, its client, a cache and a part without a name. */
const RECORD = {
  technical_design: {
    drawing: {
      parts: [
        { id: 'gw', name: 'WarehouseGateway', what: 'fetches the **live** stock' },
        { id: 'client', name: 'WarehouseClient', what: 'talks to the warehouse system' },
        { id: 'cache', name: 'Cache', what: 'remembers the stock' },
        { id: 'noname', name: '', what: 'without a name' },
      ],
    },
  },
};

type Entry = { with?: unknown; test?: string };
const story = (id: string, integration: Entry[] = [], builds: string[] = [], uses: string[] = []) => ({
  id,
  rec: { integration, drawing: { builds: Object.fromEntries(builds.map((b) => [b, 'builds it'])), uses } },
});
const cards = (raw: any[], record: any = RECORD) => integrationTests(raw, record, helpers);

describe('aidlc-turbo integration tests: the cards', () => {
  it('numbers the cards T1, T2, ... in story order, and skips an entry without with', () => {
    const raw = [
      story('001'),
      story('002', [{ with: '001', test: 'A' }, { test: 'no with' }, { with: '', test: 'empty with' }]),
      story('003', [{ with: 1, test: 'B' }, { with: '002', test: 'C' }]),
    ];
    expect(cards(raw).map((c: any) => [c.id, c.later, c.earlier, c.full])).toEqual([
      ['T1', '002', '001', 'A'],
      ['T2', '003', '001', 'B'],
      ['T3', '003', '002', 'C'],
    ]);
  });

  it('shows the text as plain text, and nothing else of it', () => {
    const [card] = cards([story('001'), story('002', [{ with: '001', test: 'The `gateway` *answers*' }])]);
    expect(card.full).toBe('The gateway answers');
    expect(Object.keys(card)).toEqual(['id', 'later', 'earlier', 'full', 'expect', 'code', 'codeFrom']);
  });
});

describe('aidlc-turbo integration tests: the expected outcome', () => {
  it('takes what comes after the last colon', () => {
    expect(outcome('Save a reading, then read it back: the stored value equals the one sent')).toBe('the stored value equals the one sent');
    expect(outcome('Step one: login, step two: the dashboard shows the stand')).toBe('the dashboard shows the stand');
  });

  it('else takes the clause with the first outcome verb, from the comma before it', () => {
    expect(outcome('With an expired password, the login returns the reset screen')).toBe('the login returns the reset screen');
    expect(outcome('The job marks the row as sent')).toBe('The job marks the row as sent');
    expect(outcome('After a failed call, the cache is not updated, and the old stand stays')).toBe('the cache is not updated, and the old stand stays');
  });

  it('is empty when the text has no clear outcome, and a short tail after a colon is none', () => {
    expect(outcome('An expired login sends the reset mail')).toBe('');
    expect(outcome('Check: it ok')).toBe('');
    expect(outcome('')).toBe('');
    expect(outcome(undefined)).toBe('');
  });

  it('is on every card, cut from its text', () => {
    const [card] = cards([story('001'), story('002', [{ with: '001', test: 'Read back: the stored value is the same' }])]);
    expect(card.expect).toBe('the stored value is the same');
  });

  it('reads the outcome words of the language the test is written in', () => {
    // xx: an invented language, upper-cased English, in a project table of its own
    const root = mkdtempSync(path.join(tmpdir(), 'turbo-integration-lang-'));
    made.push(root);
    mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
    writeFileSync(path.join(root, 'repo', 'lang', 'xx.json'), JSON.stringify({ overview: { outcomeWords: ['STAYS', 'SHOWS'] } }));
    const xx = lang.load('xx', root);
    expect(outcome('AFTER A FAILED CALL, THE OLD STOCK STAYS', xx)).toBe('THE OLD STOCK STAYS');
    expect(outcome('AFTER A FAILED CALL, THE OLD STOCK STAYS')).toBe('');
    const [card] = cards([story('001'), story('002', [{ with: '001', test: 'ON AN ERROR, THE SCREEN SHOWS THE MESSAGE' }])], RECORD);
    expect(card.expect).toBe('');
    const [own] = integrationTests([story('001'), story('002', [{ with: '001', test: 'ON AN ERROR, THE SCREEN SHOWS THE MESSAGE' }])], RECORD, { ...helpers, table: xx });
    expect(own.expect).toBe('THE SCREEN SHOWS THE MESSAGE');
  });
});

describe('aidlc-turbo integration tests: the code it runs against', () => {
  it('names the parts the text names as whole words, in the order it names them', () => {
    const [card] = cards([
      story('001', [], ['gw', 'client']),
      story('002', [{ with: '001', test: 'WarehouseClient errors reach WarehouseGateway and the CacheStore stays empty' }], ['cache']),
    ]);
    expect(card.codeFrom).toBe('test');
    // CacheStore is not Cache: only whole names count
    expect(card.code).toEqual([
      { name: 'WarehouseClient', what: 'talks to the warehouse system', story: '001' },
      { name: 'WarehouseGateway', what: 'fetches the live stock', story: '001' },
    ]);
  });

  it('gives each part the story that builds it: the earlier story first, then the later one, then any story, else none', () => {
    const raw = [
      story('001', [], ['cache']),
      story('002', [], ['gw']),
      story('003', [{ with: '002', test: 'Cache, WarehouseGateway and WarehouseClient work together' }], ['gw', 'client']),
    ];
    expect(cards(raw)[0].code.map((c: any) => [c.name, c.story])).toEqual([
      ['Cache', '001'],
      ['WarehouseGateway', '002'],
      ['WarehouseClient', '003'],
    ]);
    const nobody = cards([story('001'), story('002', [{ with: '001', test: 'Cache stays' }])]);
    expect(nobody[0].code).toEqual([{ name: 'Cache', what: 'remembers the stock', story: null }]);
  });

  it('without a named part, takes what the earlier story builds and the later one uses, from the drawing', () => {
    const [card] = cards([
      story('001', [], ['gw', 'client', 'cache']),
      story('002', [{ with: '001', test: 'The screen shows the live stand' }], [], ['client', 'gw', 'other']),
    ]);
    expect(card.codeFrom).toBe('drawing');
    // in drawing order, only what both stories share
    expect(card.code.map((c: any) => c.name)).toEqual(['WarehouseGateway', 'WarehouseClient']);
  });

  it('has no code and no source when neither the text nor the drawing names any', () => {
    const [card] = cards([story('001', [], ['cache']), story('002', [{ with: '001', test: 'The screen shows the stand' }], [], ['gw'])]);
    expect(card.code).toEqual([]);
    expect(card.codeFrom).toBe('');
    // a record without a drawing gives cards all the same
    const [bare] = cards([story('001'), story('002', [{ with: '001', test: 'WarehouseGateway answers' }])], {});
    expect(bare).toMatchObject({ id: 'T1', code: [], codeFrom: '' });
  });
});

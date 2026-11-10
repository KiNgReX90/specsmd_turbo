/**
 * Unit tests for the sync block of the AI-DLC Turbo config.
 *
 * `sync` names where the intent documentation (confluence | none) and the
 * epic and stories (jira | none) are synced. Both are optional and off by
 * default, and Enter in the questionnaire keeps them off. Any other tool is not
 * supported yet: the questionnaire says so, without naming a person, and the
 * file gets `none`, so the flow never tries to sync with a tool it does not
 * know. With Jira the link to the Jira project is
 * written too; the agent reads the site and the project key from it.
 */

import { describe, it, expect } from 'vitest';

const { renderTurboConfig, unsupportedSyncMessage, parseJiraProjectUrl, turboQuestionSections } = require('../../../lib/flow-config');
const yaml = require('js-yaml');
const { readFileSync } = require('fs');
const path = require('path');

const sync = (answers: object) => (yaml.load(renderTurboConfig(answers)) as any).sync;

describe('AI-DLC Turbo sync config', () => {
  it('syncs with nothing by default, and the questionnaire suggests nothing', () => {
    expect(sync({})).toEqual({ docs: 'none', issues: 'none' });
    const questions = turboQuestionSections().flatMap((section: any) => section.questions);
    for (const name of ['sync_docs', 'sync_issues']) {
      const q = questions.find((x: any) => x.name === name);
      expect(q.choices[q.initial].value, name).toBe('none');
    }
  });

  it('syncs with Confluence and Jira when they are chosen', () => {
    expect(sync({ sync_docs: 'confluence', sync_issues: 'jira' })).toEqual({ docs: 'confluence', issues: 'jira', jira_project_url: '' });
  });

  it('writes none when a sync is switched off, and drops the Jira project link without Jira', () => {
    expect(sync({ sync_docs: 'none', sync_issues: 'none', jira_project_url: 'https://example.atlassian.net/browse/SHOP' }))
      .toEqual({ docs: 'none', issues: 'none' });
  });

  it('writes an unsupported sync tool as none', () => {
    expect(sync({ sync_docs: 'other', sync_issues: 'notion' })).toEqual({ docs: 'none', issues: 'none' });
  });

  it('syncs with nothing in sandbox mode, whatever the answers say', () => {
    expect(sync({ mode: 'sandbox', sync_docs: 'confluence', sync_issues: 'jira', jira_project_url: 'https://example.atlassian.net/browse/SHOP' }))
      .toEqual({ docs: 'none', issues: 'none' });
  });

  it('documents the Confluence page names as a comment only with Confluence', () => {
    const withConfluence = renderTurboConfig({ sync_docs: 'confluence' });
    expect(withConfluence).toMatch(/# page_names:/);
    expect(withConfluence).toContain('#   intent: "{name} - Documentation"');
    expect(withConfluence).toContain('#   stories: "{name} - Stories"');
    expect(withConfluence).toContain('#   project: "Project Documentation"');
    expect(withConfluence).toContain('#   overview_section: "Interactive overview"');
    expect(withConfluence).toContain('#   overview_file: "overview-{slug}.html"');
    expect((yaml.load(withConfluence) as any).sync.page_names).toBeUndefined();
    expect(renderTurboConfig({})).not.toMatch(/page_names/);
  });

  it('the shipped config.example.yaml documents the same page names, commented out', () => {
    const example = readFileSync(path.join(__dirname, '../../../flows/aidlc-turbo/templates/config.example.yaml'), 'utf8');
    for (const line of ['intent: "{name} - Documentation"', 'stories: "{name} - Stories"', 'project: "Project Documentation"',
      'overview_section: "Interactive overview"', 'overview_file: "overview-{slug}.html"']) {
      expect(example).toMatch(new RegExp(`^ {2}# {3}${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
    }
  });

  it('accepts the supported tools in any case', () => {
    expect(sync({ sync_docs: 'Confluence', sync_issues: 'JIRA' })).toMatchObject({ docs: 'confluence', issues: 'jira' });
  });

  it('writes the Jira project link as it was given', () => {
    const link = 'https://example.atlassian.net/jira/software/projects/SHOP/boards/12';
    expect(sync({ sync_issues: 'jira', jira_project_url: `  ${link} ` }).jira_project_url).toBe(link);
  });

  it('never writes a bare Jira project key any more', () => {
    expect(renderTurboConfig({ sync_issues: 'jira', jira_project: 'SHOP' } as any)).not.toMatch(/jira_project:/);
  });

  it('the shipped config.example.yaml documents the same sync keys', () => {
    const example = yaml.load(readFileSync(
      path.join(__dirname, '../../../flows/aidlc-turbo/templates/config.example.yaml'), 'utf8',
    )) as any;
    expect(example.sync).toEqual(sync({}));
  });

  it('says an unsupported sync tool is not supported yet, without naming a person', () => {
    expect(unsupportedSyncMessage('Notion')).toBe('Notion is not supported yet. For now nothing is synced there.');
  });
});

describe('reading the Jira project link', () => {
  it('reads the site and the key from a board link', () => {
    expect(parseJiraProjectUrl('https://example.atlassian.net/jira/software/projects/SHOP/boards/12'))
      .toEqual({ site: 'example.atlassian.net', key: 'SHOP' });
  });

  it('reads the key from a team-managed board link', () => {
    expect(parseJiraProjectUrl('https://example.atlassian.net/jira/software/c/projects/shop/boards/3/backlog'))
      .toEqual({ site: 'example.atlassian.net', key: 'SHOP' });
  });

  it('reads the key from an issue link', () => {
    expect(parseJiraProjectUrl('https://example.atlassian.net/browse/SHOP-123')?.key).toBe('SHOP');
  });

  it('reads the key from a projectKey query', () => {
    expect(parseJiraProjectUrl('https://example.atlassian.net/secure/RapidBoard.jspa?projectKey=SHOP')?.key).toBe('SHOP');
  });

  it('rejects text that is not a link', () => {
    expect(parseJiraProjectUrl('SHOP')).toBeNull();
  });

  it('rejects a link that names no project', () => {
    expect(parseJiraProjectUrl('https://example.atlassian.net/jira/your-work')).toBeNull();
  });
});

/**
 * Tree building functions for converting parsed artifacts to tree nodes.
 */

import { MemoryBankModel, Intent, Unit, Story, Bolt, Standard, ArtifactStatus } from '../parser/types';
import {
    TreeNode,
    RootIntentsNode,
    RootBoltsNode,
    RootStandardsNode,
    IntentNode,
    UnitNode,
    StoryNode,
    BoltNode,
    StandardNode,
    STATUS_INDICATORS
} from './types';

/**
 * Creates root section nodes.
 */
export function createRootNodes(): TreeNode[] {
    const intentsRoot: RootIntentsNode = {
        kind: 'root-intents',
        label: 'Intents',
        id: 'root-intents'
    };

    const boltsRoot: RootBoltsNode = {
        kind: 'root-bolts',
        label: 'Bolts',
        id: 'root-bolts'
    };

    const standardsRoot: RootStandardsNode = {
        kind: 'root-standards',
        label: 'Standards',
        id: 'root-standards'
    };

    return [intentsRoot, boltsRoot, standardsRoot];
}

/**
 * Formats a label with status indicator.
 */
function formatLabelWithStatus(label: string, status: ArtifactStatus): string {
    const indicator = STATUS_INDICATORS[status];
    return indicator ? `${label} ${indicator}` : label;
}

/**
 * Creates intent nodes from model.
 */
export function createIntentNodes(model: MemoryBankModel): IntentNode[] {
    return model.intents.map(intent => createIntentNode(intent));
}

/**
 * Creates a single intent node.
 */
export function createIntentNode(intent: Intent): IntentNode {
    const label = `${intent.number}-${intent.name}`;
    return {
        kind: 'intent',
        label: formatLabelWithStatus(label, intent.status),
        id: `intent-${intent.number}-${intent.name}`,
        data: intent
    };
}

/**
 * Creates unit nodes from an intent.
 */
export function createUnitNodes(intent: Intent): UnitNode[] {
    return intent.units.map(unit => createUnitNode(unit));
}

/**
 * Creates a single unit node.
 */
export function createUnitNode(unit: Unit): UnitNode {
    return {
        kind: 'unit',
        label: formatLabelWithStatus(unit.name, unit.status),
        id: `unit-${unit.intentName}-${unit.name}`,
        data: unit
    };
}

/**
 * Creates story nodes from a unit.
 */
export function createStoryNodes(unit: Unit): StoryNode[] {
    return unit.stories.map(story => createStoryNode(story));
}

/**
 * Creates a single story node.
 */
export function createStoryNode(story: Story): StoryNode {
    const label = `${story.id}-${story.title}`;
    return {
        kind: 'story',
        label: formatLabelWithStatus(label, story.status),
        id: `story-${story.intentName}-${story.unitName}-${story.id}`,
        data: story
    };
}

/**
 * Creates bolt nodes from model.
 */
export function createBoltNodes(model: MemoryBankModel): BoltNode[] {
    return model.bolts.map(bolt => createBoltNode(bolt));
}

/**
 * Creates a single bolt node.
 */
export function createBoltNode(bolt: Bolt): BoltNode {
    let label = bolt.id;

    // Add current stage info for in-progress bolts
    if (bolt.status === ArtifactStatus.InProgress && bolt.currentStage) {
        label = `${bolt.id} (${bolt.currentStage})`;
    }

    return {
        kind: 'bolt',
        label: formatLabelWithStatus(label, bolt.status),
        id: `bolt-${bolt.id}`,
        data: bolt
    };
}

/**
 * Creates standard nodes from model.
 */
export function createStandardNodes(model: MemoryBankModel): StandardNode[] {
    return model.standards.map(standard => createStandardNode(standard));
}

/**
 * Creates a single standard node.
 */
export function createStandardNode(standard: Standard): StandardNode {
    return {
        kind: 'standard',
        label: standard.name,
        id: `standard-${standard.name}`,
        data: standard
    };
}

/**
 * Gets children for a tree node.
 */
export function getChildNodes(node: TreeNode, model: MemoryBankModel): TreeNode[] {
    switch (node.kind) {
        case 'root-intents':
            return createIntentNodes(model);
        case 'root-bolts':
            return createBoltNodes(model);
        case 'root-standards':
            return createStandardNodes(model);
        case 'intent':
            return createUnitNodes(node.data);
        case 'unit':
            return createStoryNodes(node.data);
        case 'story':
        case 'bolt':
        case 'standard':
            return [];
    }
}

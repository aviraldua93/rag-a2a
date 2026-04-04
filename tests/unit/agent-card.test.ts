/**
 * Unit tests for A2A Agent Card generation.
 */
import { describe, test, expect } from 'bun:test';
import { createAgentCard, type AgentCard } from '../../src/a2a/agent-card.ts';

describe('createAgentCard', () => {
  const baseUrl = 'http://localhost:3737';
  let card: AgentCard;

  // Create the card once for all tests
  card = createAgentCard(baseUrl);

  test('has correct card structure with required fields', () => {
    expect(card.name).toBe('RAG-A2A Agent');
    expect(typeof card.description).toBe('string');
    expect(card.description.length).toBeGreaterThan(0);
    expect(card.version).toBe('0.1.0');
    expect(card.defaultInputModes).toContain('text');
    expect(card.defaultOutputModes).toContain('text');
    expect(card.provider).toBeDefined();
    expect(card.provider!.organization).toBe('rag-a2a');
  });

  test('skills array contains retrieve, answer, and search skills', () => {
    expect(card.skills).toBeInstanceOf(Array);
    expect(card.skills.length).toBe(3);

    const skillIds = card.skills.map(s => s.id);
    expect(skillIds).toContain('retrieve');
    expect(skillIds).toContain('answer');
    expect(skillIds).toContain('search');

    // Each skill should have required fields
    for (const skill of card.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  test('url field includes baseUrl with /a2a path', () => {
    expect(card.url).toBe(`${baseUrl}/a2a`);
  });

  test('capabilities flags are correctly set', () => {
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  test('uses different baseUrl correctly', () => {
    const customCard = createAgentCard('https://my-agent.example.com');
    expect(customCard.url).toBe('https://my-agent.example.com/a2a');
  });
});

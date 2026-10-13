import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyClaudeMessage, isMetaUserText } from '../src/agents/claude-items.js';
import { partToItem } from '../src/agents/opencode-items.js';
import { Transcript } from '../src/agents/transcript.js';
import { toolTitle, truncate } from '../src/agents/types.js';

describe('Claude transcript conversion', () => {
  it('hides slash-command plumbing', () => {
    assert.equal(isMetaUserText('<command-name>/clear</command-name>'), true);
    assert.equal(isMetaUserText('fix the bug'), false);
  });

  it('pairs tool calls with their results', () => {
    const tx = new Transcript();
    applyClaudeMessage(tx, 'user', 'add a test', 'u1', 1);
    applyClaudeMessage(tx, 'assistant', [{ type: 'text', text: 'Sure.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }], 'a1', 2);
    applyClaudeMessage(tx, 'user', [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }], 'u2', 3);
    const items = tx.list();
    assert.deepEqual(
      items.map((i) => i.kind),
      ['user', 'text', 'tool'],
    );
    assert.equal(items[2].tool?.title, 'Read: a.ts');
    assert.equal(items[2].tool?.status, 'done');
    assert.equal(items[2].tool?.output, 'file body');
  });

  it('marks failed tools and notes attached photos', () => {
    const tx = new Transcript();
    applyClaudeMessage(tx, 'assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'false' } }], 'a1', 1);
    applyClaudeMessage(tx, 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'exit 1', is_error: true }], 'u1', 2);
    applyClaudeMessage(tx, 'user', [{ type: 'image', source: {} }, { type: 'text', text: 'what is this?' }], 'u2', 3);
    const items = tx.list();
    assert.equal(items[0].tool?.status, 'error');
    assert.equal(items[1].text, 'what is this?\n📷 1 photo');
  });
});

describe('OpenCode part conversion', () => {
  it('maps text, reasoning and tool parts', () => {
    const base = { sessionID: 's', messageID: 'm' };
    assert.equal(partToItem({ ...base, id: 'p1', type: 'text', text: 'hi' }, 'user')?.kind, 'user');
    assert.equal(partToItem({ ...base, id: 'p2', type: 'text', text: 'hello' }, 'assistant')?.kind, 'text');
    assert.equal(partToItem({ ...base, id: 'p3', type: 'text', text: 'x', synthetic: true }, 'assistant'), undefined);
    assert.equal(partToItem({ ...base, id: 'p4', type: 'reasoning', text: 'hmm', time: { start: 1 } }, 'assistant')?.kind, 'thinking');
    const tool = partToItem(
      {
        ...base,
        id: 'p5',
        type: 'tool',
        callID: 'c',
        tool: 'bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb', title: 'List files', metadata: {}, time: { start: 1, end: 2 } },
      },
      'assistant',
    );
    assert.equal(tool?.tool?.status, 'done');
    assert.equal(tool?.tool?.title, 'bash: List files');
    assert.equal(tool?.tool?.output, 'a\nb');
  });
});

describe('formatting helpers', () => {
  it('summarises tool calls', () => {
    assert.equal(toolTitle('Bash', { command: 'npm test\nmore' }), 'Bash: npm test');
    assert.equal(toolTitle('Glob', { pattern: '**/*.ts' }), 'Glob: **/*.ts');
    assert.equal(toolTitle('Unknown', {}), 'Unknown');
  });

  it('truncates long output', () => {
    assert.match(truncate('x'.repeat(10), 4), /^xxxx\n… \(6 more characters\)$/);
  });
});

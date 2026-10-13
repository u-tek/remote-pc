import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import type { ClaudeSdk } from '../src/agents/claude.js';
import { startTestAgent, waitFor, type TestAgent } from './helpers.js';

/**
 * A stand-in for the Agent SDK's query(): for every user turn it asks permission to run
 * Bash (or asks a question when the prompt says so) and reports what it was told.
 */
function fakeSdk(log: { permissions: unknown[]; options?: Record<string, any> }): ClaudeSdk {
  const query = ((params: { prompt: AsyncIterable<any>; options: Record<string, any> }) => {
    log.options = params.options;
    const sessionId = params.options.sessionId ?? params.options.resume;
    async function* run() {
      yield { type: 'system', subtype: 'init', model: 'claude-test', permissionMode: params.options.permissionMode, session_id: sessionId };
      let n = 0;
      for await (const turn of params.prompt) {
        n++;
        const text = typeof turn.message.content === 'string' ? turn.message.content : '';
        const controller = new AbortController();
        if (text.includes('ask')) {
          const input = { questions: [{ question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }], multiSelect: false }] };
          const result = await params.options.canUseTool('AskUserQuestion', input, { signal: controller.signal, toolUseID: `q${n}` });
          log.permissions.push(result);
        } else {
          yield { type: 'assistant', uuid: `a${n}`, parent_tool_use_id: null, session_id: sessionId, message: { content: [{ type: 'tool_use', id: `tu${n}`, name: 'Bash', input: { command: 'echo hi' } }] } };
          const result = await params.options.canUseTool('Bash', { command: 'echo hi' }, {
            signal: controller.signal,
            toolUseID: `tu${n}`,
            title: 'Claude wants to run echo hi',
            suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'echo:*' }], behavior: 'allow', destination: 'session' }],
          });
          log.permissions.push(result);
          yield { type: 'user', parent_tool_use_id: null, session_id: sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: 'hi' }] } };
        }
        yield { type: 'result', subtype: 'success', is_error: false, duration_ms: 1500, total_cost_usd: 0.01, uuid: `r${n}`, session_id: sessionId };
      }
    }
    const gen = run() as AsyncGenerator<any> & Record<string, unknown>;
    gen.interrupt = async () => undefined;
    gen.setPermissionMode = async () => undefined;
    gen.close = () => undefined;
    return gen;
  }) as unknown as ClaudeSdk['query'];

  return {
    query,
    listSessions: (async () => []) as unknown as ClaudeSdk['listSessions'],
    getSessionMessages: (async () => []) as unknown as ClaudeSdk['getSessionMessages'],
    getSessionInfo: (async () => undefined) as unknown as ClaudeSdk['getSessionInfo'],
  };
}

describe('Claude Code sessions with phone approvals', () => {
  let t: TestAgent;
  const log: { permissions: unknown[]; options?: Record<string, any> } = { permissions: [] };
  const events: any[] = [];
  let ws: WebSocket;

  before(async () => {
    t = await startTestAgent({ claudeSdk: fakeSdk(log) });
    ws = new WebSocket(`${t.base.replace('http', 'ws')}/api/ws`, { headers: { authorization: `Bearer ${t.token}` } });
    ws.on('message', (m) => events.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.once('open', r));
  });
  after(async () => {
    ws.close();
    await t.close();
  });

  let sessionId = '';

  it('starts a session, streams the tool call and waits for approval', async () => {
    const { status, data } = await t.call('POST', '/api/sessions', { agent: 'claude', cwd: t.dir, text: 'run echo' });
    assert.equal(status, 200, JSON.stringify(data));
    sessionId = data.id;
    assert.equal(log.options?.sessionId, sessionId);
    assert.equal(log.options?.permissionMode, 'default');

    const approval = await waitFor(async () => (await t.call('GET', '/api/approvals')).data.approvals[0]);
    assert.equal(approval.toolName, 'Bash');
    assert.equal(approval.canAlways, true);
    assert.equal(approval.title, 'Claude wants to run echo hi');
    assert.ok(events.some((e) => e.type === 'approval' && e.approval.id === approval.id));

    const ok = await t.call('POST', `/api/approvals/${approval.id}`, { decision: 'always' });
    assert.equal(ok.status, 200);
    const result = (await waitFor(() => log.permissions[0])) as any;
    assert.equal(result.behavior, 'allow');
    assert.equal(result.updatedPermissions.length, 1);

    const items = await waitFor(async () => {
      const r = await t.call('GET', `/api/sessions/claude/${sessionId}/items`);
      return r.data.some((i: any) => i.kind === 'result') ? r.data : undefined;
    });
    const tool = items.find((i: any) => i.kind === 'tool');
    assert.equal(tool.tool.status, 'done');
    assert.equal(tool.tool.output, 'hi');
    assert.equal(tool.tool.title, 'Bash: echo hi');
    assert.equal(items[0].kind, 'user');
    assert.ok(events.some((e) => e.type === 'approval_done' && e.id === approval.id));
  });

  it('denies with the message typed on the phone', async () => {
    await t.call('POST', `/api/sessions/claude/${sessionId}/prompt`, { text: 'run it again' });
    const approval = await waitFor(async () => (await t.call('GET', '/api/approvals')).data.approvals[0]);
    await t.call('POST', `/api/approvals/${approval.id}`, { decision: 'deny', message: 'not now' });
    const result = (await waitFor(() => log.permissions[1])) as any;
    assert.deepEqual(result, { behavior: 'deny', message: 'not now' });
  });

  it('turns AskUserQuestion into a question card and returns the answers', async () => {
    await t.call('POST', `/api/sessions/claude/${sessionId}/prompt`, { text: 'please ask me' });
    const question = await waitFor(async () => (await t.call('GET', '/api/approvals')).data.questions[0]);
    assert.equal(question.questions[0].question, 'Which color?');
    assert.deepEqual(
      question.questions[0].options.map((o: any) => o.label),
      ['Red', 'Blue'],
    );
    await t.call('POST', `/api/questions/${question.id}`, { answers: [['Blue']] });
    const result = (await waitFor(() => log.permissions[2])) as any;
    assert.equal(result.behavior, 'allow');
    assert.deepEqual(result.updatedInput.answers, { 'Which color?': 'Blue' });
  });

  it('rejects an empty prompt', async () => {
    const { status } = await t.call('POST', `/api/sessions/claude/${sessionId}/prompt`, { text: '  ' });
    assert.equal(status, 400);
  });

  it('refuses to start a session in a missing folder', async () => {
    const { status } = await t.call('POST', '/api/sessions', { agent: 'claude', cwd: '/definitely/not/here', text: 'hi' });
    assert.equal(status, 400);
  });
});

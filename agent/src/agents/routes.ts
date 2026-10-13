import type { ConfigStore } from '../config.js';
import { HttpError, requireString, type Router } from '../http.js';
import type { Hub } from '../hub.js';
import type { AgentKind, AgentProvider, Decision, PromptInput, SessionSummary } from './types.js';

const MODES = new Set(['default', 'acceptEdits', 'plan']);

function parsePrompt(body: { text?: unknown; images?: unknown }): PromptInput {
  const text = typeof body.text === 'string' ? body.text : '';
  const images = Array.isArray(body.images)
    ? (body.images as Array<{ mime?: unknown; data?: unknown }>)
        .filter((i) => typeof i?.mime === 'string' && typeof i?.data === 'string')
        .map((i) => ({ mime: i.mime as string, data: i.data as string }))
    : [];
  return { text, images };
}

export function registerAgentRoutes(router: Router, hub: Hub, store: ConfigStore, providers: Record<AgentKind, AgentProvider>): void {
  const provider = (agent: string): AgentProvider => {
    const p = providers[agent as AgentKind];
    if (!p) throw new HttpError(404, `Unknown agent ${agent}`);
    return p;
  };

  router.get('/api/sessions', async ({ query }) => {
    const only = query.get('agent');
    const kinds = (Object.keys(providers) as AgentKind[]).filter((k) => !only || k === only);
    const errors: Record<string, string> = {};
    const lists = await Promise.all(
      kinds.map(async (k) => {
        try {
          return await providers[k].listSessions();
        } catch (err) {
          errors[k] = err instanceof Error ? err.message : String(err);
          return [] as SessionSummary[];
        }
      }),
    );
    const sessions = lists.flat().map((s) => ({ ...s, pending: hub.pendingFor(s.key) }));
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return { sessions, errors };
  });

  router.post('/api/sessions', async (ctx) => {
    const body = await ctx.json<{ agent?: string; cwd?: string; text?: string; images?: unknown; mode?: string; model?: string }>();
    const p = provider(requireString(body.agent, 'agent'));
    const cwd = requireString(body.cwd, 'cwd');
    if (body.mode && !MODES.has(body.mode)) throw new HttpError(400, 'Unknown mode');
    return p.create({ cwd, prompt: parsePrompt(body), mode: body.mode, model: body.model });
  });

  router.get('/api/sessions/:agent/:id/items', async ({ params }) => provider(params.agent).getItems(params.id));

  router.post('/api/sessions/:agent/:id/prompt', async (ctx) => {
    const prompt = parsePrompt(await ctx.json());
    if (!prompt.text.trim() && !prompt.images?.length) throw new HttpError(400, 'Empty message');
    await provider(ctx.params.agent).send(ctx.params.id, prompt);
    return { ok: true };
  });

  router.post('/api/sessions/:agent/:id/interrupt', async ({ params }) => {
    await provider(params.agent).interrupt(params.id);
    return { ok: true };
  });

  router.post('/api/sessions/:agent/:id/mode', async (ctx) => {
    const { mode } = await ctx.json<{ mode?: string }>();
    if (!mode || !MODES.has(mode)) throw new HttpError(400, 'Unknown mode');
    const p = provider(ctx.params.agent);
    if (!p.setMode) throw new HttpError(400, 'This agent has no permission modes');
    await p.setMode(ctx.params.id, mode);
    return { ok: true };
  });

  router.get('/api/approvals', () => ({ approvals: hub.pendingApprovals(), questions: hub.pendingQuestions() }));

  router.post('/api/approvals/:id', async (ctx) => {
    const body = await ctx.json<{ decision?: string; message?: string }>();
    if (body.decision !== 'allow' && body.decision !== 'always' && body.decision !== 'deny') throw new HttpError(400, 'decision must be allow, always or deny');
    const decision: Decision = { decision: body.decision, message: typeof body.message === 'string' ? body.message : undefined };
    if (!(await hub.decide(ctx.params.id, decision))) throw new HttpError(404, 'That request was already answered');
    return { ok: true };
  });

  router.post('/api/questions/:id', async (ctx) => {
    const body = await ctx.json<{ answers?: unknown }>();
    let answers: string[][] | null = null;
    if (Array.isArray(body.answers)) answers = body.answers.map((a) => (Array.isArray(a) ? a.map(String) : [String(a)]));
    if (!(await hub.answer(ctx.params.id, answers))) throw new HttpError(404, 'That question was already answered');
    return { ok: true };
  });

  router.get('/api/projects', async () => {
    const recent = (await Promise.all(Object.values(providers).map((p) => p.recentDirectories().catch(() => [] as string[])))).flat();
    const pinned = store.data.projects;
    return { pinned, recent: [...new Set(recent)].filter((d) => !pinned.includes(d)).slice(0, 30) };
  });

  router.post('/api/projects', async (ctx) => {
    const { path } = await ctx.json<{ path?: string }>();
    const dir = requireString(path, 'path');
    store.update((c) => {
      if (!c.projects.includes(dir)) c.projects.unshift(dir);
    });
    return { pinned: store.data.projects };
  });

  router.delete('/api/projects', ({ query }) => {
    const dir = requireString(query.get('path'), 'path');
    store.update((c) => {
      c.projects = c.projects.filter((p) => p !== dir);
    });
    return { pinned: store.data.projects };
  });
}

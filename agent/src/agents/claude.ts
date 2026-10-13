import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config.js';
import { HttpError } from '../http.js';
import type { Hub } from '../hub.js';
import { log } from '../log.js';
import { applyClaudeMessage } from './claude-items.js';
import { Transcript } from './transcript.js';
import {
  stringify,
  truncate,
  type AgentProvider,
  type Approval,
  type ChatItem,
  type CreateOptions,
  type Decision,
  type PromptInput,
  type QuestionPrompt,
  type SessionStatus,
  type SessionSummary,
} from './types.js';

/** Push-based async iterable that feeds user turns into a streaming query(). */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) throw new Error('session input is closed');
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: msg, done: false });
    else this.buffer.push(msg);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true } as IteratorResult<SDKUserMessage>);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.buffer.shift();
        if (next) return Promise.resolve({ value: next, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true } as IteratorResult<SDKUserMessage>);
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

interface LiveSession {
  id: string;
  cwd: string;
  title: string;
  status: SessionStatus;
  model?: string;
  mode: string;
  branch?: string;
  lastActive: number;
  input: InputQueue;
  q?: Query;
  tx: Transcript;
}

interface SessionMeta {
  cwd: string;
  title: string;
  updatedAt: number;
  branch?: string;
}

type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** SDK entry points, injectable so tests can run without a real Claude Code process. */
export interface ClaudeSdk {
  query: typeof query;
  listSessions: typeof listSessions;
  getSessionMessages: typeof getSessionMessages;
  getSessionInfo: typeof getSessionInfo;
}

const realSdk: ClaudeSdk = { query, listSessions, getSessionMessages, getSessionInfo };
const IMAGE_MIMES: ImageMime[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export class ClaudeProvider implements AgentProvider {
  readonly kind = 'claude' as const;
  private live = new Map<string, LiveSession>();
  private meta = new Map<string, SessionMeta>();
  private reaper: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly hub: Hub,
    private readonly sdk: ClaudeSdk = realSdk,
  ) {
    this.reaper = setInterval(() => this.reapIdle(), 60_000);
    this.reaper.unref();
  }

  async status() {
    if (!this.config.claude.enabled) return { available: false, detail: 'Disabled in config' };
    return { available: true };
  }

  private key(id: string) {
    return `claude:${id}`;
  }

  private summary(live: LiveSession): SessionSummary {
    return {
      key: this.key(live.id),
      agent: 'claude',
      id: live.id,
      title: live.title,
      cwd: live.cwd,
      updatedAt: live.lastActive,
      status: live.status,
      live: true,
      pending: this.hub.pendingFor(this.key(live.id)),
      model: live.model,
      branch: live.branch,
      mode: live.mode,
    };
  }

  private emitSession(live: LiveSession) {
    this.hub.publish({ type: 'session', session: this.summary(live) });
  }

  private emitItems(live: LiveSession, items: ChatItem[]) {
    if (items.length) this.hub.publish({ type: 'items', sessionKey: this.key(live.id), items });
  }

  async listSessions(): Promise<SessionSummary[]> {
    const out = new Map<string, SessionSummary>();
    try {
      const infos = await this.sdk.listSessions({ limit: 80 });
      for (const info of infos) {
        const title = info.customTitle || info.summary || info.firstPrompt || 'Untitled session';
        const meta: SessionMeta = {
          cwd: info.cwd ?? '',
          title: title.length > 100 ? title.slice(0, 97) + '…' : title,
          updatedAt: info.lastModified,
          branch: info.gitBranch,
        };
        this.meta.set(info.sessionId, meta);
        out.set(info.sessionId, {
          key: this.key(info.sessionId),
          agent: 'claude',
          id: info.sessionId,
          title: meta.title,
          cwd: meta.cwd,
          updatedAt: meta.updatedAt,
          status: 'idle',
          live: false,
          pending: 0,
          branch: meta.branch,
        });
      }
    } catch (err) {
      log.warn('claude: listing sessions failed', err);
    }
    for (const live of this.live.values()) out.set(live.id, this.summary(live));
    return [...out.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async recentDirectories(): Promise<string[]> {
    if (this.meta.size === 0) await this.listSessions();
    const dirs = [...this.meta.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((m) => m.cwd)
      .filter(Boolean);
    return [...new Set(dirs)];
  }

  private async historyItems(id: string): Promise<ChatItem[]> {
    const tx = new Transcript();
    const messages = await this.sdk.getSessionMessages(id);
    for (const m of messages) {
      if (m.parent_tool_use_id) continue; // subagent internals
      if (m.type !== 'user' && m.type !== 'assistant') continue;
      const content = (m.message as { content?: unknown } | undefined)?.content;
      applyClaudeMessage(tx, m.type, content, m.uuid, 0);
    }
    return tx.list();
  }

  async getItems(id: string): Promise<ChatItem[]> {
    const live = this.live.get(id);
    if (live) return live.tx.list();
    return this.historyItems(id);
  }

  private async lookup(id: string): Promise<SessionMeta> {
    const known = this.meta.get(id);
    if (known?.cwd) return known;
    const info = await this.sdk.getSessionInfo(id);
    if (!info?.cwd) throw new HttpError(404, 'Claude session not found');
    const meta: SessionMeta = {
      cwd: info.cwd,
      title: info.customTitle || info.summary || 'Untitled session',
      updatedAt: info.lastModified,
      branch: info.gitBranch,
    };
    this.meta.set(id, meta);
    return meta;
  }

  private start(id: string, cwd: string, opts: { resume: boolean; title: string; mode?: string; history?: ChatItem[]; model?: string }): LiveSession {
    const live: LiveSession = {
      id,
      cwd,
      title: opts.title,
      status: 'idle',
      mode: opts.mode ?? this.config.claude.defaultPermissionMode,
      lastActive: Date.now(),
      input: new InputQueue(),
      tx: Transcript.from(opts.history ?? []),
    };
    const env: Record<string, string | undefined> = { ...process.env };
    live.q = this.sdk.query({
      prompt: live.input,
      options: {
        cwd,
        ...(opts.resume ? { resume: id } : { sessionId: id }),
        canUseTool: this.makeCanUseTool(live),
        permissionMode: live.mode as PermissionMode,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        pathToClaudeCodeExecutable: this.config.claude.executable || undefined,
        model: opts.model || this.config.claude.model || undefined,
        env,
        stderr: (data: string) => log.warn(`claude[${id.slice(0, 8)}]`, data.trim()),
      },
    });
    this.live.set(id, live);
    void this.pump(live);
    this.emitSession(live);
    return live;
  }

  private async pump(live: LiveSession) {
    try {
      for await (const msg of live.q!) this.handle(live, msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`claude[${live.id.slice(0, 8)}] stopped`, message);
      live.status = 'error';
      this.emitItems(live, [live.tx.upsert({ id: `err-${Date.now()}`, kind: 'error', text: `Claude Code stopped: ${message}`, ts: Date.now() })]);
    } finally {
      this.live.delete(live.id);
      this.meta.set(live.id, { cwd: live.cwd, title: live.title, updatedAt: live.lastActive, branch: live.branch });
      const summary = this.summary(live);
      summary.live = false;
      if (summary.status !== 'error') summary.status = 'idle';
      this.hub.publish({ type: 'session', session: summary });
    }
  }

  private handle(live: LiveSession, msg: SDKMessage) {
    live.lastActive = Date.now();
    const now = Date.now();
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          live.model = msg.model;
          live.mode = msg.permissionMode;
          this.emitSession(live);
        } else if (msg.subtype === 'session_state_changed') {
          const pending = this.hub.pendingFor(this.key(live.id)) > 0;
          live.status = msg.state === 'running' ? (pending ? 'waiting' : 'running') : msg.state === 'requires_action' ? 'waiting' : 'idle';
          this.emitSession(live);
        }
        return;
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) return;
        this.emitItems(live, applyClaudeMessage(live.tx, 'assistant', msg.message.content, msg.uuid, now));
        return;
      }
      case 'user': {
        if (msg.parent_tool_use_id) return;
        const content = msg.message.content;
        // Only tool results matter here; our own prompts are added when sent.
        if (!Array.isArray(content)) return;
        const results = content.filter((b) => (b as { type?: string }).type === 'tool_result');
        if (results.length) this.emitItems(live, applyClaudeMessage(live.tx, 'user', results, `tr-${now}`, now));
        return;
      }
      case 'result': {
        live.status = 'idle';
        let item: ChatItem;
        if (msg.subtype === 'success' && !msg.is_error) {
          const secs = Math.round(msg.duration_ms / 1000);
          const cost = msg.total_cost_usd ? ` · $${msg.total_cost_usd.toFixed(2)}` : '';
          item = { id: `res-${msg.uuid}`, kind: 'result', text: `Done in ${secs}s${cost}`, ts: now };
        } else {
          const errors = 'errors' in msg && Array.isArray(msg.errors) ? msg.errors.join('\n') : '';
          const resultText = 'result' in msg && typeof msg.result === 'string' ? msg.result : '';
          item = { id: `res-${msg.uuid}`, kind: 'error', text: errors || resultText || `Stopped (${msg.subtype})`, ts: now };
        }
        this.emitItems(live, [live.tx.upsert(item)]);
        this.emitSession(live);
        return;
      }
      default:
        return;
    }
  }

  private makeCanUseTool(live: LiveSession): CanUseTool {
    return async (toolName, input, opts): Promise<PermissionResult> => {
      const key = this.key(live.id);
      if (toolName === 'AskUserQuestion') return this.askQuestion(live, input, opts.signal);

      let detail = opts.description ?? opts.decisionReason;
      let inputText = truncate(stringify(input));
      if (toolName === 'ExitPlanMode' && typeof input.plan === 'string') {
        detail = 'Claude finished planning and wants to start making changes.';
        inputText = truncate(input.plan, 20000);
      }
      const approval: Approval = {
        id: `claude-${opts.toolUseID || randomUUID()}`,
        agent: 'claude',
        sessionKey: key,
        sessionTitle: live.title,
        title: opts.title ?? `Claude wants to use ${toolName}`,
        detail,
        toolName,
        input: inputText,
        canAlways: Boolean(opts.suggestions?.length) && !opts.suppressAlwaysAllowRule,
        createdAt: Date.now(),
      };
      live.status = 'waiting';
      const decision = await new Promise<Decision>((resolve) => {
        const onAbort = () => {
          this.hub.dropApproval(approval.id);
          resolve({ decision: 'deny', message: 'Cancelled' });
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        this.hub.addApproval(approval, (d) => {
          opts.signal.removeEventListener('abort', onAbort);
          resolve(d);
        });
        this.emitSession(live);
      });
      live.status = this.hub.pendingFor(key) > 0 ? 'waiting' : 'running';
      this.emitSession(live);
      if (decision.decision === 'deny') {
        return { behavior: 'deny', message: decision.message?.trim() || 'The user denied this from their phone.' };
      }
      if (decision.decision === 'always' && opts.suggestions?.length) {
        return { behavior: 'allow', updatedInput: input, updatedPermissions: opts.suggestions };
      }
      return { behavior: 'allow', updatedInput: input };
    };
  }

  private async askQuestion(live: LiveSession, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    type RawQuestion = { question?: unknown; header?: unknown; options?: Array<{ label?: unknown; description?: unknown }>; multiSelect?: unknown };
    const raw = Array.isArray(input.questions) ? (input.questions as RawQuestion[]) : [];
    const prompt: QuestionPrompt = {
      id: `claude-q-${randomUUID()}`,
      agent: 'claude',
      sessionKey: this.key(live.id),
      sessionTitle: live.title,
      questions: raw.map((q) => ({
        question: String(q.question ?? ''),
        header: String(q.header ?? ''),
        options: (q.options ?? []).map((o) => ({
          label: String(o.label ?? ''),
          description: typeof o.description === 'string' ? o.description : undefined,
        })),
        multiple: Boolean(q.multiSelect),
        custom: true,
      })),
      createdAt: Date.now(),
    };
    live.status = 'waiting';
    const answers = await new Promise<string[][] | null>((resolve) => {
      const onAbort = () => {
        this.hub.dropQuestion(prompt.id);
        resolve(null);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.hub.addQuestion(prompt, (a) => {
        signal.removeEventListener('abort', onAbort);
        resolve(a);
      });
      this.emitSession(live);
    });
    live.status = 'running';
    this.emitSession(live);
    if (!answers) return { behavior: 'deny', message: 'The user dismissed the question.' };
    const map: Record<string, string> = {};
    prompt.questions.forEach((q, i) => {
      map[q.question] = (answers[i] ?? []).join(', ');
    });
    return { behavior: 'allow', updatedInput: { ...input, answers: map } };
  }

  async create(opts: CreateOptions): Promise<SessionSummary> {
    const info = await stat(opts.cwd).catch(() => null);
    if (!info?.isDirectory()) throw new HttpError(400, `Folder not found: ${opts.cwd}`);
    const id = randomUUID();
    const title = opts.prompt?.text.trim().split('\n')[0].slice(0, 80) || 'New session';
    const live = this.start(id, opts.cwd, { resume: false, title, mode: opts.mode, model: opts.model });
    this.meta.set(id, { cwd: opts.cwd, title, updatedAt: Date.now() });
    if (opts.prompt?.text || opts.prompt?.images?.length) await this.send(id, opts.prompt);
    return this.summary(live);
  }

  async send(id: string, prompt: PromptInput): Promise<void> {
    let live = this.live.get(id);
    if (!live) {
      const meta = await this.lookup(id);
      const history = await this.historyItems(id).catch(() => []);
      live = this.start(id, meta.cwd, { resume: true, title: meta.title, history });
      live.branch = meta.branch;
    }
    const images = (prompt.images ?? []).filter((img) => IMAGE_MIMES.includes(img.mime as ImageMime));
    const content = images.length
      ? [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mime as ImageMime, data: img.data },
          })),
          { type: 'text' as const, text: prompt.text || 'See the attached photo.' },
        ]
      : prompt.text;
    const uuid = randomUUID();
    live.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid });
    const photoNote = images.length ? `\n📷 ${images.length} photo${images.length > 1 ? 's' : ''}` : '';
    this.emitItems(live, [live.tx.upsert({ id: `u-${uuid}`, kind: 'user', text: prompt.text + photoNote, ts: Date.now() })]);
    live.status = 'running';
    live.lastActive = Date.now();
    this.emitSession(live);
  }

  async interrupt(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live?.q) return;
    await live.q.interrupt();
  }

  async setMode(id: string, mode: string): Promise<void> {
    const live = this.live.get(id);
    if (!live?.q) throw new HttpError(409, 'Session is not running; the mode applies when you send the next message.');
    await live.q.setPermissionMode(mode as PermissionMode);
    live.mode = mode;
    this.emitSession(live);
  }

  private reapIdle() {
    const limit = this.config.claude.idleCloseMinutes * 60_000;
    for (const live of this.live.values()) {
      const idle = live.status === 'idle' || live.status === 'error';
      if (idle && Date.now() - live.lastActive > limit && this.hub.pendingFor(this.key(live.id)) === 0) {
        log.info(`claude[${live.id.slice(0, 8)}] closing idle session`);
        live.input.close();
        live.q?.close();
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.reaper);
    for (const live of this.live.values()) {
      live.input.close();
      live.q?.close();
    }
  }
}

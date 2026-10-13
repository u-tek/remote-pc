import { stat } from 'node:fs/promises';
import {
  createOpencodeClient,
  createOpencodeServer,
  type Event as OcEvent,
  type OpencodeClient,
  type Part,
  type Session,
} from '@opencode-ai/sdk/v2';
import type { Config } from '../config.js';
import { HttpError } from '../http.js';
import type { Hub } from '../hub.js';
import { log } from '../log.js';
import { partToItem } from './opencode-items.js';
import {
  stringify,
  truncate,
  type AgentProvider,
  type ChatItem,
  type CreateOptions,
  type PromptInput,
  type SessionStatus,
  type SessionSummary,
} from './types.js';

type Role = 'user' | 'assistant';

function errorText(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; data?: { message?: unknown }; name?: unknown };
  if (typeof e.data?.message === 'string') return e.data.message;
  if (typeof e.message === 'string') return e.message;
  if (typeof e.name === 'string') return e.name;
  return stringify(err);
}

function unwrap<T>(res: { data?: T; error?: unknown }): T {
  if (res.error !== undefined && res.error !== null) throw new Error(errorText(res.error));
  return res.data as T;
}

const VERBS: Record<string, string> = {
  edit: 'edit files',
  bash: 'run a command',
  webfetch: 'fetch a web page',
  websearch: 'search the web',
  external_directory: 'work outside the project folder',
  read: 'read files',
  task: 'start a sub-agent',
  doom_loop: 'keep repeating the same action',
};

export class OpenCodeProvider implements AgentProvider {
  readonly kind = 'opencode' as const;
  private client?: OpencodeClient;
  private server?: { url: string; close(): void };
  private starting?: Promise<OpencodeClient>;
  private startError?: string;
  private stopped = false;
  private sessions = new Map<string, Session>();
  private statuses = new Map<string, SessionStatus>();
  private roles = new Map<string, Role>();
  private parts = new Map<string, { part: Part; role?: Role }>();
  private flushTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: Config,
    private readonly hub: Hub,
  ) {}

  /** Start (or connect to) the OpenCode server in the background. */
  warmUp(): void {
    if (!this.config.opencode.enabled) return;
    this.ensure().catch((err) => log.warn('opencode: not available —', err instanceof Error ? err.message : err));
  }

  async status() {
    if (!this.config.opencode.enabled) return { available: false, detail: 'Disabled in config' };
    if (this.client) return { available: true };
    if (this.starting) return { available: false, detail: 'Starting…' };
    return { available: false, detail: this.startError ?? 'Not started' };
  }

  private ensure(): Promise<OpencodeClient> {
    if (!this.config.opencode.enabled) return Promise.reject(new HttpError(503, 'OpenCode is disabled in the agent config'));
    if (this.client) return Promise.resolve(this.client);
    if (!this.starting) {
      this.starting = this.boot()
        .then((c) => {
          this.startError = undefined;
          return c;
        })
        .catch((err: unknown) => {
          this.starting = undefined;
          this.startError = err instanceof Error ? err.message.split('\n')[0] : String(err);
          throw new HttpError(503, `OpenCode is not available: ${this.startError}`);
        });
    }
    return this.starting;
  }

  private async boot(): Promise<OpencodeClient> {
    let url = this.config.opencode.url;
    if (!url) {
      const port = this.config.opencode.port;
      try {
        this.server = await createOpencodeServer({
          hostname: '127.0.0.1',
          port,
          timeout: 30_000,
          config: this.config.opencode.askPermissions
            ? { permission: { edit: 'ask', bash: 'ask', webfetch: 'ask', external_directory: 'ask' } }
            : {},
        });
        url = this.server.url;
        log.info(`opencode: server started at ${url}`);
      } catch (err) {
        // Maybe `opencode serve` is already running on that port; use it if it answers.
        const fallback = `http://127.0.0.1:${port}`;
        const probe = createOpencodeClient({ baseUrl: fallback });
        const health = await probe.global.health().catch(() => undefined);
        if (!health?.data) throw err;
        log.info(`opencode: using existing server at ${fallback}`);
        url = fallback;
      }
    }
    const client = createOpencodeClient({ baseUrl: url });
    this.client = client;
    void this.listen(client);
    return client;
  }

  private async listen(client: OpencodeClient) {
    while (!this.stopped) {
      try {
        const sse = await client.global.event();
        for await (const ge of sse.stream) {
          if (this.stopped) return;
          const payload = (ge as { directory?: string; payload?: unknown }).payload as OcEvent | undefined;
          if (payload) this.onEvent(payload, (ge as { directory?: string }).directory);
        }
      } catch (err) {
        if (!this.stopped) log.warn('opencode: event stream dropped', err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private key(id: string) {
    return `opencode:${id}`;
  }

  private summaryOf(info: Session): SessionSummary {
    const key = this.key(info.id);
    const pending = this.hub.pendingFor(key);
    let status = this.statuses.get(info.id) ?? 'idle';
    if (status === 'running' && pending > 0) status = 'waiting';
    return {
      key,
      agent: 'opencode',
      id: info.id,
      title: info.title || 'Untitled session',
      cwd: info.directory,
      updatedAt: info.time.updated,
      status,
      live: status !== 'idle',
      pending,
      model: info.model ? `${info.model.providerID}/${info.model.id}` : undefined,
    };
  }

  private emitSession(id: string) {
    const info = this.sessions.get(id);
    if (info) this.hub.publish({ type: 'session', session: this.summaryOf(info) });
  }

  private emitItems(sessionID: string, items: ChatItem[]) {
    if (items.length) this.hub.publish({ type: 'items', sessionKey: this.key(sessionID), items });
  }

  private rememberRole(messageID: string, role: Role) {
    this.roles.set(messageID, role);
    if (this.roles.size > 5000) {
      const first = this.roles.keys().next().value;
      if (first) this.roles.delete(first);
    }
  }

  private rememberPart(part: Part, role?: Role) {
    if (part.type !== 'text' && part.type !== 'reasoning') return;
    this.parts.set(part.id, { part, role });
    if (this.parts.size > 2000) {
      const first = this.parts.keys().next().value;
      if (first) this.parts.delete(first);
    }
  }

  private scheduleFlush(partID: string) {
    if (this.flushTimers.has(partID)) return;
    this.flushTimers.set(
      partID,
      setTimeout(() => {
        this.flushTimers.delete(partID);
        const entry = this.parts.get(partID);
        if (!entry) return;
        const item = partToItem(entry.part, entry.role);
        if (item) this.emitItems(entry.part.sessionID, [item]);
      }, 150),
    );
  }

  private onEvent(ev: OcEvent, directory?: string) {
    switch (ev.type) {
      case 'session.created':
      case 'session.updated': {
        this.sessions.set(ev.properties.info.id, ev.properties.info);
        this.emitSession(ev.properties.info.id);
        return;
      }
      case 'session.deleted': {
        this.sessions.delete(ev.properties.info.id);
        return;
      }
      case 'session.status': {
        const s = ev.properties.status;
        this.statuses.set(ev.properties.sessionID, s.type === 'idle' ? 'idle' : 'running');
        this.emitSession(ev.properties.sessionID);
        return;
      }
      case 'session.idle': {
        this.statuses.set(ev.properties.sessionID, 'idle');
        this.emitSession(ev.properties.sessionID);
        return;
      }
      case 'session.error': {
        const sid = ev.properties.sessionID;
        if (!sid) return;
        this.emitItems(sid, [{ id: `err-${ev.id}`, kind: 'error', text: errorText(ev.properties.error), ts: Date.now() }]);
        return;
      }
      case 'message.updated': {
        const info = ev.properties.info;
        this.rememberRole(info.id, info.role);
        return;
      }
      case 'message.part.updated': {
        const part = ev.properties.part;
        const role = this.roles.get(part.messageID);
        this.rememberPart(part, role);
        const item = partToItem(part, role);
        if (item) this.emitItems(part.sessionID, [item]);
        return;
      }
      case 'message.part.delta': {
        const { partID, field, delta } = ev.properties;
        const entry = this.parts.get(partID);
        if (!entry || field !== 'text') return;
        if (entry.part.type === 'text' || entry.part.type === 'reasoning') {
          entry.part = { ...entry.part, text: entry.part.text + delta };
          this.scheduleFlush(partID);
        }
        return;
      }
      case 'permission.asked': {
        const p = ev.properties;
        const dir = directory ?? this.sessions.get(p.sessionID)?.directory;
        const info = this.sessions.get(p.sessionID);
        const id = `oc-p-${p.id}`;
        this.hub.addApproval(
          {
            id,
            agent: 'opencode',
            sessionKey: this.key(p.sessionID),
            sessionTitle: info?.title ?? 'OpenCode session',
            title: `OpenCode wants to ${VERBS[p.permission] ?? `use ${p.permission}`}`,
            detail: p.patterns.join('\n') || undefined,
            toolName: p.permission,
            input: truncate(stringify(p.metadata), 20000),
            canAlways: p.always.length > 0,
            createdAt: Date.now(),
          },
          async (d) => {
            const client = await this.ensure();
            unwrap(
              await client.permission.reply({
                requestID: p.id,
                directory: dir,
                reply: d.decision === 'always' ? 'always' : d.decision === 'allow' ? 'once' : 'reject',
                message: d.decision === 'deny' && d.message ? d.message : undefined,
              }),
            );
          },
        );
        this.emitSession(p.sessionID);
        return;
      }
      case 'permission.replied': {
        this.hub.dropApproval(`oc-p-${ev.properties.requestID}`);
        this.emitSession(ev.properties.sessionID);
        return;
      }
      case 'question.asked': {
        const q = ev.properties;
        const dir = directory ?? this.sessions.get(q.sessionID)?.directory;
        this.hub.addQuestion(
          {
            id: `oc-q-${q.id}`,
            agent: 'opencode',
            sessionKey: this.key(q.sessionID),
            sessionTitle: this.sessions.get(q.sessionID)?.title ?? 'OpenCode session',
            questions: q.questions.map((x) => ({
              question: x.question,
              header: x.header,
              options: x.options.map((o) => ({ label: o.label, description: o.description })),
              multiple: Boolean(x.multiple),
              custom: x.custom !== false,
            })),
            createdAt: Date.now(),
          },
          async (answers) => {
            const client = await this.ensure();
            if (answers) unwrap(await client.question.reply({ requestID: q.id, directory: dir, answers }));
            else unwrap(await client.question.reject({ requestID: q.id, directory: dir }));
          },
        );
        this.emitSession(q.sessionID);
        return;
      }
      case 'question.replied':
      case 'question.rejected': {
        this.hub.dropQuestion(`oc-q-${ev.properties.requestID}`);
        return;
      }
      default:
        return;
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const client = await this.ensure();
    const projects = unwrap(await client.project.list());
    const dirs = [...new Set(projects.map((p) => p.worktree).filter((w) => w && w !== '/'))];
    const lists = await Promise.all(
      dirs.map((directory) =>
        client.session
          .list({ directory, roots: true, limit: 40 })
          .then((r) => unwrap(r))
          .catch(() => [] as Session[]),
      ),
    );
    for (const info of lists.flat()) this.sessions.set(info.id, info);
    return [...this.sessions.values()]
      .filter((s) => !s.parentID && !s.time.archived)
      .map((s) => this.summaryOf(s))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async recentDirectories(): Promise<string[]> {
    if (this.sessions.size === 0) await this.listSessions().catch(() => []);
    const dirs = [...this.sessions.values()].sort((a, b) => b.time.updated - a.time.updated).map((s) => s.directory);
    return [...new Set(dirs)];
  }

  private dirOf(id: string): string {
    const info = this.sessions.get(id);
    if (!info) throw new HttpError(404, 'OpenCode session not found (refresh the session list)');
    return info.directory;
  }

  async getItems(id: string): Promise<ChatItem[]> {
    const client = await this.ensure();
    const directory = this.dirOf(id);
    const messages = unwrap(await client.session.messages({ sessionID: id, directory, limit: 200 }));
    const items: ChatItem[] = [];
    for (const { info, parts } of messages) {
      this.rememberRole(info.id, info.role);
      for (const part of parts) {
        const item = partToItem(part, info.role);
        if (item) items.push(item.ts ? item : { ...item, ts: info.time.created });
      }
      if (info.role === 'assistant' && info.error && info.error.name !== 'MessageAbortedError') {
        items.push({ id: `err-${info.id}`, kind: 'error', text: errorText(info.error), ts: info.time.created });
      }
    }
    return items;
  }

  async create(opts: CreateOptions): Promise<SessionSummary> {
    const info = await stat(opts.cwd).catch(() => null);
    if (!info?.isDirectory()) throw new HttpError(400, `Folder not found: ${opts.cwd}`);
    const client = await this.ensure();
    const session = unwrap(await client.session.create({ directory: opts.cwd }));
    this.sessions.set(session.id, session);
    if (opts.prompt?.text || opts.prompt?.images?.length) await this.send(session.id, opts.prompt);
    return this.summaryOf(session);
  }

  async send(id: string, prompt: PromptInput): Promise<void> {
    const client = await this.ensure();
    const directory = this.dirOf(id);
    const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename: string }> = [];
    (prompt.images ?? []).forEach((img, i) => {
      const ext = img.mime.split('/')[1] ?? 'jpg';
      parts.push({ type: 'file', mime: img.mime, url: `data:${img.mime};base64,${img.data}`, filename: `photo-${i + 1}.${ext}` });
    });
    parts.push({ type: 'text', text: prompt.text || 'See the attached photo.' });
    unwrap(await client.session.promptAsync({ sessionID: id, directory, parts }));
    this.statuses.set(id, 'running');
    this.emitSession(id);
  }

  async interrupt(id: string): Promise<void> {
    const client = await this.ensure();
    unwrap(await client.session.abort({ sessionID: id, directory: this.dirOf(id) }));
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const t of this.flushTimers.values()) clearTimeout(t);
    this.server?.close();
  }
}

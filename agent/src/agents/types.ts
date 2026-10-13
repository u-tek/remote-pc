export type AgentKind = 'claude' | 'opencode';

export type SessionStatus = 'idle' | 'running' | 'waiting' | 'error';

export interface SessionSummary {
  /** `${agent}:${id}` — unique across agents. */
  key: string;
  agent: AgentKind;
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  status: SessionStatus;
  /** True while a process for this session is running on the PC. */
  live: boolean;
  pending: number;
  model?: string;
  branch?: string;
  mode?: string;
}

export type ItemKind = 'user' | 'text' | 'thinking' | 'tool' | 'error' | 'result' | 'info';

export interface ToolInfo {
  name: string;
  title: string;
  input: string;
  output?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

/** One row in the chat transcript. Items are upserted by id. */
export interface ChatItem {
  id: string;
  kind: ItemKind;
  text?: string;
  tool?: ToolInfo;
  ts: number;
}

export interface Approval {
  id: string;
  agent: AgentKind;
  sessionKey: string;
  sessionTitle: string;
  title: string;
  detail?: string;
  toolName: string;
  input: string;
  canAlways: boolean;
  createdAt: number;
}

export interface Decision {
  decision: 'allow' | 'always' | 'deny';
  message?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionPrompt {
  id: string;
  agent: AgentKind;
  sessionKey: string;
  sessionTitle: string;
  questions: Array<{
    question: string;
    header: string;
    options: QuestionOption[];
    multiple: boolean;
    custom: boolean;
  }>;
  createdAt: number;
}

export interface PromptInput {
  text: string;
  images?: Array<{ mime: string; data: string }>;
}

export interface CreateOptions {
  cwd: string;
  prompt?: PromptInput;
  mode?: string;
  model?: string;
}

export interface AgentProvider {
  readonly kind: AgentKind;
  status(): Promise<{ available: boolean; detail?: string }>;
  listSessions(): Promise<SessionSummary[]>;
  getItems(id: string): Promise<ChatItem[]>;
  create(opts: CreateOptions): Promise<SessionSummary>;
  send(id: string, prompt: PromptInput): Promise<void>;
  interrupt(id: string): Promise<void>;
  setMode?(id: string, mode: string): Promise<void>;
  recentDirectories(): Promise<string[]>;
  shutdown(): Promise<void>;
}

export const MAX_TOOL_TEXT = 6000;

export function truncate(text: string, max = MAX_TOOL_TEXT): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n… (${text.length - max} more characters)`;
}

export function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** A short human label for a tool call, e.g. `Bash: npm test` or `Edit: src/app.ts`. */
export function toolTitle(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = i[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const detail =
    pick('command', 'cmd') ??
    pick('file_path', 'filePath', 'path', 'notebook_path') ??
    pick('pattern', 'query', 'url') ??
    pick('description', 'prompt', 'subject');
  if (!detail) return name;
  const oneLine = detail.split('\n')[0];
  return `${name}: ${oneLine.length > 120 ? oneLine.slice(0, 117) + '…' : oneLine}`;
}

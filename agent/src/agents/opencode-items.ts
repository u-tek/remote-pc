import type { Part } from '@opencode-ai/sdk/v2';
import { stringify, toolTitle, truncate, type ChatItem, type ToolInfo } from './types.js';

const TOOL_STATUS: Record<string, ToolInfo['status']> = {
  pending: 'pending',
  running: 'running',
  completed: 'done',
  error: 'error',
};

/** Map one OpenCode message part to a transcript item (or undefined if it is not shown). */
export function partToItem(part: Part, role: 'user' | 'assistant' | undefined): ChatItem | undefined {
  switch (part.type) {
    case 'text': {
      if (part.synthetic || part.ignored || !part.text.trim()) return undefined;
      return { id: part.id, kind: role === 'user' ? 'user' : 'text', text: part.text, ts: part.time?.start ?? 0 };
    }
    case 'reasoning': {
      if (!part.text.trim()) return undefined;
      return { id: part.id, kind: 'thinking', text: part.text, ts: part.time.start };
    }
    case 'tool': {
      const state = part.state;
      const input = (state.input ?? {}) as Record<string, unknown>;
      let output: string | undefined;
      let title = toolTitle(part.tool, input);
      if (state.status === 'completed') {
        output = truncate(state.output ?? '');
        if (state.title) title = `${part.tool}: ${state.title}`;
      } else if (state.status === 'error') {
        output = truncate(state.error ?? '');
      } else if (state.status === 'running' && state.title) {
        title = `${part.tool}: ${state.title}`;
      }
      const ts = 'time' in state && state.time ? state.time.start : 0;
      return {
        id: part.id,
        kind: 'tool',
        ts,
        tool: { name: part.tool, title, input: truncate(stringify(input)), output, status: TOOL_STATUS[state.status] ?? 'running' },
      };
    }
    case 'file': {
      if (role !== 'user') return undefined;
      return { id: part.id, kind: 'user', text: `📎 ${part.filename ?? 'attachment'}`, ts: 0 };
    }
    default:
      return undefined;
  }
}

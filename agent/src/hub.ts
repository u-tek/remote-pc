import { EventEmitter } from 'node:events';
import type { Approval, ChatItem, Decision, QuestionPrompt, SessionSummary } from './agents/types.js';

export type HubEvent =
  | { type: 'session'; session: SessionSummary }
  | { type: 'items'; sessionKey: string; items: ChatItem[] }
  | { type: 'approval'; approval: Approval }
  | { type: 'approval_done'; id: string }
  | { type: 'question'; question: QuestionPrompt }
  | { type: 'question_done'; id: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

type ApprovalResolver = (d: Decision) => Promise<void> | void;
type QuestionResolver = (answers: string[][] | null) => Promise<void> | void;

/**
 * Central event bus plus the registry of things waiting on the phone:
 * tool approvals and agent questions from either Claude Code or OpenCode.
 */
export class Hub extends EventEmitter {
  private approvals = new Map<string, { approval: Approval; resolve: ApprovalResolver }>();
  private questions = new Map<string, { question: QuestionPrompt; resolve: QuestionResolver }>();

  publish(event: HubEvent): void {
    this.emit('event', event);
  }

  onEvent(listener: (e: HubEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  addApproval(approval: Approval, resolve: ApprovalResolver): void {
    this.approvals.set(approval.id, { approval, resolve });
    this.publish({ type: 'approval', approval });
  }

  /** Remove an approval that was settled elsewhere (answered on the PC, cancelled, ...). */
  dropApproval(id: string): void {
    if (this.approvals.delete(id)) this.publish({ type: 'approval_done', id });
  }

  async decide(id: string, decision: Decision): Promise<boolean> {
    const entry = this.approvals.get(id);
    if (!entry) return false;
    this.approvals.delete(id);
    this.publish({ type: 'approval_done', id });
    await entry.resolve(decision);
    return true;
  }

  pendingApprovals(): Approval[] {
    return [...this.approvals.values()].map((e) => e.approval);
  }

  pendingFor(sessionKey: string): number {
    let n = 0;
    for (const { approval } of this.approvals.values()) if (approval.sessionKey === sessionKey) n++;
    for (const { question } of this.questions.values()) if (question.sessionKey === sessionKey) n++;
    return n;
  }

  addQuestion(question: QuestionPrompt, resolve: QuestionResolver): void {
    this.questions.set(question.id, { question, resolve });
    this.publish({ type: 'question', question });
  }

  dropQuestion(id: string): void {
    if (this.questions.delete(id)) this.publish({ type: 'question_done', id });
  }

  async answer(id: string, answers: string[][] | null): Promise<boolean> {
    const entry = this.questions.get(id);
    if (!entry) return false;
    this.questions.delete(id);
    this.publish({ type: 'question_done', id });
    await entry.resolve(answers);
    return true;
  }

  pendingQuestions(): QuestionPrompt[] {
    return [...this.questions.values()].map((e) => e.question);
  }
}

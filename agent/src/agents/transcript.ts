import type { ChatItem } from './types.js';

const MAX_ITEMS = 600;

/** Ordered, id-addressable list of chat items for one session. */
export class Transcript {
  private items = new Map<string, ChatItem>();
  private order: string[] = [];

  static from(items: ChatItem[]): Transcript {
    const t = new Transcript();
    for (const item of items) t.upsert(item);
    return t;
  }

  upsert(item: ChatItem): ChatItem {
    if (!this.items.has(item.id)) {
      this.order.push(item.id);
      if (this.order.length > MAX_ITEMS) {
        const dropped = this.order.splice(0, this.order.length - MAX_ITEMS);
        for (const id of dropped) this.items.delete(id);
      }
    }
    this.items.set(item.id, item);
    return item;
  }

  get(id: string): ChatItem | undefined {
    return this.items.get(id);
  }

  list(): ChatItem[] {
    return this.order.map((id) => this.items.get(id)!).filter(Boolean);
  }
}

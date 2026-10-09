/** Enforces one active agent session per browser tab. */
export class TabRunRegistry {
  private readonly owners = new Map<number, string>();

  acquire(tabId: number, requestId: string): (() => void) | undefined {
    if (this.owners.has(tabId)) return undefined;
    this.owners.set(tabId, requestId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.owners.get(tabId) === requestId) this.owners.delete(tabId);
    };
  }

  ownerOf(tabId: number): string | undefined {
    return this.owners.get(tabId);
  }
}

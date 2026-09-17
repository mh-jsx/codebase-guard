export type PendingChangeKind = "scan" | "delete";

export interface PendingChange<T> {
  readonly key: string;
  readonly value: T;
  readonly kind: PendingChangeKind;
  readonly priority: number;
}

/** Keeps only the latest event for each file and drains security-sensitive work first. */
export class ChangeBatch<T> {
  private readonly items = new Map<string, PendingChange<T>>();

  public get size(): number {
    return this.items.size;
  }

  public upsert(change: PendingChange<T>): void {
    this.items.set(change.key, change);
  }

  public drain(): PendingChange<T>[] {
    const drained = [...this.items.values()].sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
    this.items.clear();
    return drained;
  }

  public clear(): void {
    this.items.clear();
  }
}

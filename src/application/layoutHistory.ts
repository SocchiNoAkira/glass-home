import type { LayoutTransaction } from '@/src/domain/layout/transaction';

export class LayoutHistory {
  private past: LayoutTransaction[] = [];
  private future: LayoutTransaction[] = [];

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoCount(): number { return this.past.length; }
  get redoCount(): number { return this.future.length; }

  record(transaction: LayoutTransaction): void {
    this.past.push(transaction);
    this.future = [];
  }

  peekUndo(): LayoutTransaction | undefined { return this.past.at(-1); }
  peekRedo(): LayoutTransaction | undefined { return this.future.at(-1); }

  completeUndo(): void {
    const transaction = this.past.pop();
    if (transaction) this.future.push(transaction);
  }

  completeRedo(): void {
    const transaction = this.future.pop();
    if (transaction) this.past.push(transaction);
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

export interface LayoutOperationToken {
  readonly operationId: number;
  readonly baseRevision: number;
  readonly targetSignature: string;
  readonly signal: AbortSignal;
}

/** Synchronous solver results still pass through this guard before reaching UI. */
export class LayoutPreviewCoordinator {
  private generation = 0;
  private controller: AbortController | undefined;

  begin(baseRevision: number, targetSignature: string): LayoutOperationToken {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.generation += 1;
    return { operationId: this.generation, baseRevision, targetSignature, signal: controller.signal };
  }

  isCurrent(token: LayoutOperationToken): boolean {
    return token.operationId === this.generation && !token.signal.aborted;
  }

  finish(token: LayoutOperationToken): void {
    if (this.isCurrent(token)) this.controller = undefined;
  }

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = undefined;
  }
}

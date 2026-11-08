export type LayoutTransactionStatus =
  | 'draft'
  | 'validated'
  | 'committed'
  | 'cancelled'
  | 'rolled-back';

export interface LayoutTransaction<TSnapshot, TChange = unknown> {
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly nextRevision: number;
  readonly before: TSnapshot;
  readonly candidate: TSnapshot;
  readonly changes: readonly TChange[];
  readonly status: LayoutTransactionStatus;
  readonly createdAt: string;
}

import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import {
  BRIDGE_ERROR_CODES, BRIDGE_MAX_REQUESTS_PER_WINDOW, BRIDGE_RATE_WINDOW_MS, BRIDGE_REQUEST_TIMEOUT_MS,
  isBridgeRequest, makeBridgeError, makeBridgeResponse, type BridgeError, type BridgeResponse, type BridgeRequest,
} from '@/src/domain/widget/bridge';

/**
 * Host-side router for one sandbox widget instance (baseline 10.4/10.5).
 *
 * The router is DOM-free on purpose: it receives a plain `{ source, data, origin }`
 * record, which makes every security rule testable without a browser. The frame
 * binding is a thin adapter in `sandboxBridge.ts`.
 *
 * Rules enforced here, in this order:
 * 1. the message must come from the window this session was opened for;
 * 2. it must be a well-formed request under the versioned protocol;
 * 3. its `instanceId` must match the bound instance — a widget can never
 *    authorise itself by claiming an id;
 * 4. a repeated `messageId` is rejected, so a replay cannot be answered twice;
 * 5. the per-window request budget must not be exhausted;
 * 6. only `environment.get` is served; anything else answers with a stable
 *    error code instead of silently doing nothing.
 */

export interface BridgeMessageEventLike {
  readonly source: unknown;
  readonly data: unknown;
  readonly origin?: string;
}

export interface BridgeRouterOptions {
  readonly instanceId: string;
  /** The window this session belongs to; compared by identity, never by name. */
  readonly expectedSource: unknown;
  readonly environment: () => WidgetEnvironment;
  readonly now?: () => number;
  readonly maxRequestsPerWindow?: number;
  readonly rateWindowMs?: number;
  readonly requestTimeoutMs?: number;
}

export type RouterOutcome =
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'reply'; readonly message: BridgeResponse | BridgeError }
  | { readonly kind: 'rate-limited'; readonly message: BridgeError };

interface RateState {
  windowStartedAt: number;
  count: number;
}

export class SandboxBridgeRouter {
  private readonly seenMessageIds = new Set<string>();
  private readonly rate: RateState = { windowStartedAt: 0, count: 0 };
  private closed = false;
  private readonly now: () => number;
  private readonly maxRequests: number;
  private readonly rateWindowMs: number;

  constructor(private readonly options: BridgeRouterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxRequests = options.maxRequestsPerWindow ?? BRIDGE_MAX_REQUESTS_PER_WINDOW;
    this.rateWindowMs = options.rateWindowMs ?? BRIDGE_RATE_WINDOW_MS;
  }

  /** Baseline 10.5: a message from an unloaded widget must be refused. */
  close(): void {
    this.closed = true;
    this.seenMessageIds.clear();
  }

  get timeoutMs(): number {
    return this.options.requestTimeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;
  }

  handle(event: BridgeMessageEventLike): RouterOutcome {
    if (this.closed) return { kind: 'ignored', reason: '会话已关闭。' };
    // Identity comparison, not a claimed name: `event.source` is the only
    // trustworthy link between a message and its frame.
    if (!this.options.expectedSource || event.source !== this.options.expectedSource) {
      return { kind: 'ignored', reason: '消息来源不是本实例的沙箱窗口。' };
    }
    const data: unknown = event.data;
    if (!isBridgeRequest(data)) {
      // Non-protocol chatter is dropped rather than answered: replying would
      // turn the host into an oracle for malformed input.
      return { kind: 'ignored', reason: '消息未通过协议校验。' };
    }
    if (data.instanceId !== this.options.instanceId) {
      return {
        kind: 'reply',
        message: makeBridgeError(data, data.method, BRIDGE_ERROR_CODES.instanceMismatch, '实例标识与本会话不符。', this.now()),
      };
    }
    if (this.seenMessageIds.has(data.messageId)) {
      return { kind: 'ignored', reason: '重复的消息标识，已忽略。' };
    }

    if (!this.takeBudget()) {
      const message = makeBridgeError(data, data.method, BRIDGE_ERROR_CODES.rateLimited, '请求过于频繁，请稍后重试。', this.now());
      return { kind: 'rate-limited', message };
    }

    // Only after the message is authenticated and within budget does it become
    // part of the dedupe set; otherwise a spammer could poison it for free.
    this.seenMessageIds.add(data.messageId);
    return this.dispatch(data);
  }

  private dispatch(request: BridgeRequest): RouterOutcome {
    if (request.method !== 'environment.get') {
      return {
        kind: 'reply',
        message: makeBridgeError(request, request.method, BRIDGE_ERROR_CODES.unsupportedMethod, '此沙箱会话未开放该能力。', this.now()),
      };
    }
    return { kind: 'reply', message: makeBridgeResponse(request, this.options.environment(), this.now()) };
  }

  private takeBudget(): boolean {
    const now = this.now();
    if (now - this.rate.windowStartedAt >= this.rateWindowMs) {
      this.rate.windowStartedAt = now;
      this.rate.count = 0;
    }
    if (this.rate.count >= this.maxRequests) return false;
    this.rate.count += 1;
    return true;
  }
}

/** Timing helper used by the frame adapter to expire unanswered requests. */
export function isExpired(requestStartedAt: number, now: number, timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS): boolean {
  return now - requestStartedAt > timeoutMs;
}

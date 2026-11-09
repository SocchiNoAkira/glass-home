import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import { isBridgeResponse, type BridgeResponse } from '@/src/domain/widget/bridge';
import { SandboxBridgeRouter } from './bridgeRouter';

/**
 * Frame adapter for the sandbox bridge.
 *
 * Direction matters: baseline 10.6 defines capabilities the **widget** asks the
 * **host** for, so the sandbox sends `environment.get` and this adapter answers
 * it. Putting the direction the other way round makes the router useless: it
 * authorises *incoming* messages, and a host-initiated request would arrive at
 * the sandbox with nothing checking it.
 *
 * All security rules live in `SandboxBridgeRouter`, which is unit-tested
 * without a browser. This file only moves messages across the boundary.
 */

export interface SandboxSessionOptions {
  readonly instanceId: string;
  readonly environment: () => WidgetEnvironment;
  /** A valid request was served; the reply has already been delivered. */
  readonly onGranted: (environment: WidgetEnvironment) => void;
  /** The host refused a request; `reason` is safe to show. */
  readonly onRefused?: (reason: string) => void;
  /** No valid request arrived within the window. */
  readonly onTimeout?: () => void;
  readonly timeoutMs?: number;
}

export interface SandboxSession {
  dispose(): void;
}

export function createSandboxSession(frame: HTMLIFrameElement, options: SandboxSessionOptions): SandboxSession {
  const router = new SandboxBridgeRouter({
    instanceId: options.instanceId,
    // Read at send time: assigning `frame.src` replaces the window object.
    expectedSource: frame.contentWindow,
    environment: options.environment,
  });
  let answered = false;

  const reply = (message: BridgeResponse) => {
    const target = frame.contentWindow;
    if (!target) return;
    // `'*'` is unavoidable for an opaque sandbox origin. The sandbox validates
    // the shape and the host validated the request, so no data leaks either way.
    target.postMessage(message, '*');
    answered = true;
    options.onGranted(message.payload);
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    const outcome = router.handle({ source: event.source, data: event.data });
    if (outcome.kind === 'ignored') return;
    const message = outcome.message;
    if ('error' in message) {
      // Tell the widget why; do not surface it as an app error.
      frame.contentWindow?.postMessage(message, '*');
      options.onRefused?.(message.error.message);
      return;
    }
    if (!isBridgeResponse(message)) return;
    reply(message);
  };

  window.addEventListener('message', onMessage);

  // The sandbox is expected to announce itself and ask once. If nothing valid
  // arrives, report a timeout instead of leaving the panel on "connecting".
  const timeoutMs = options.timeoutMs ?? router.timeoutMs;
  const expiry = window.setTimeout(() => {
    if (!answered) options.onTimeout?.();
  }, timeoutMs);

  return {
    dispose() {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(expiry);
      router.close();
    },
  };
}

export type { BridgeResponse };

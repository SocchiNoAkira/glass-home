import { WIDGET_PROTOCOL_VERSION, isWidgetProbeRequest } from '@/src/domain/widget/protocol';

let parentAccess = 'blocked';
let extensionApiAccess = 'blocked';

try {
  void window.parent.document;
  parentAccess = 'accessible';
} catch {
  // Expected: the opaque sandbox origin cannot access its parent DOM.
}

try {
  const extensionGlobal = globalThis as typeof globalThis & {
    chrome?: { runtime?: { id?: string } };
  };
  extensionApiAccess = typeof extensionGlobal.chrome?.runtime?.id === 'string' ? 'accessible' : 'blocked';
} catch {
  // Expected: sandbox pages do not receive extension APIs.
}

const response = {
  protocolVersion: WIDGET_PROTOCOL_VERSION,
  type: 'widget-probe-response' as const,
  nonce: '',
  payload: {
    parentAccess,
    extensionApiAccess,
    userAgent: navigator.userAgent,
  },
};

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isWidgetProbeRequest(event.data)) return;
  if (event.data.type !== 'widget-probe-request') return;
  if (typeof event.data.nonce !== 'string' || event.data.nonce.length < 12) return;

  event.source.postMessage({ ...response, nonce: event.data.nonce }, { targetOrigin: '*' });
});

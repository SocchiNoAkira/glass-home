import {
  WIDGET_PROTOCOL_VERSION,
  isWidgetProbeRequest,
  isWidgetProbeResponse,
  type WidgetProbeResponse,
} from '@/src/domain/widget/protocol';

export type SandboxProbeResult =
  | { status: 'passed'; detail: string }
  | { status: 'failed'; detail: string };

export async function runSandboxProbe(frame: HTMLIFrameElement): Promise<SandboxProbeResult> {
  const nonce = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({ status: 'failed', detail: '沙箱响应超时（5000ms）。' });
    }, 5000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow) return;
      if (!isWidgetProbeResponse(event.data) || event.data.nonce !== nonce) return;
      cleanup();
      const payload: WidgetProbeResponse['payload'] = event.data.payload;
      resolve({
        status: 'passed',
        detail: `父 DOM：${payload.parentAccess === 'blocked' ? '已隔离' : '异常'}；扩展 API：${
          payload.extensionApiAccess === 'blocked' ? '不可用' : '异常'
        }。`,
      });
    };

    window.addEventListener('message', onMessage);
    const request = {
      protocolVersion: WIDGET_PROTOCOL_VERSION,
      type: 'widget-probe-request' as const,
      nonce,
    };
    if (!isWidgetProbeRequest(request)) {
      cleanup();
      resolve({ status: 'failed', detail: '宿主请求未通过协议校验。' });
      return;
    }

    // Sandbox documents have an opaque origin. Source-window identity, nonce and
    // runtime payload validation are required; a claimed extension origin is not trusted.
    frame.contentWindow?.postMessage(request, '*');
  });
}

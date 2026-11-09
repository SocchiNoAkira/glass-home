import { WIDGET_PROTOCOL_VERSION } from '@/src/domain/widget/protocol';
import { isWidgetEnvironment, type WidgetEnvironment } from '@/src/domain/widget/environment';

/**
 * Sandbox demo widget (STAGE 3 DEV ONLY, baseline 10.4).
 *
 * This page proves the host <-> sandbox channel works while staying inside the
 * sandbox: it cannot reach the parent DOM, cannot use extension APIs, and the
 * only capability it may ask for is the read-only `environment.get`.
 *
 * The widget **requests**, the host **answers** (baseline 10.6). The instance
 * id below is what the host cross-checks against the frame it bound, so a
 * widget cannot authorise itself by echoing a different id.
 */

const INSTANCE_ID = 'builtin.sandbox-demo';

const status = document.getElementById('status');
const host = document.getElementById('environment');

function render(message: string) {
  if (status) status.textContent = message;
}

function renderEnvironment(environment: WidgetEnvironment) {
  if (!host) return;
  host.replaceChildren();
  const rows: [string, string][] = [
    ['主题', environment.theme === 'dark' ? '深色' : '浅色'],
    ['语言', environment.language],
    ['尺寸', `${environment.size.w} × ${environment.size.h} 格`],
    ['减少动态', environment.reducedMotion ? '开启' : '关闭'],
    ['材质', environment.materialQuality],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'env-row';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('strong');
    val.textContent = value;
    row.append(key, val);
    host.append(row);
  }
  host.dataset.widgetEnvironment = 'received';
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  // Only the host may answer this page; a same-window postMessage is ignored.
  if (event.source !== window.parent) return;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return;
  const candidate = data as Record<string, unknown>;
  if (candidate.type === 'response' && isWidgetEnvironment(candidate.payload)) {
    render('已从宿主取得环境信息');
    renderEnvironment(candidate.payload);
    return;
  }
  if (candidate.type === 'error') {
    const error = candidate.error as { message?: unknown } | undefined;
    const message = typeof error?.message === 'string' ? error.message : '未知原因';
    render(`宿主拒绝：${message}`);
  }
});

// Announce readiness, then ask the host for the one capability this demo uses.
// The host authorises the request; this page never decides its own permissions.
window.parent.postMessage(
  { protocolVersion: WIDGET_PROTOCOL_VERSION, type: 'event', method: 'sandbox.ready', instanceId: INSTANCE_ID },
  '*',
);

function requestEnvironment() {
  window.parent.postMessage(
    {
      protocolVersion: WIDGET_PROTOCOL_VERSION,
      type: 'request',
      messageId: `${INSTANCE_ID}-${Date.now()}`,
      instanceId: INSTANCE_ID,
      method: 'environment.get',
      payload: {},
      timestamp: Date.now(),
    },
    '*',
  );
}

// Wait a frame so the host has attached its listener before the request lands.
window.requestAnimationFrame(() => {
  render('正在向宿主请求环境信息…');
  requestEnvironment();
});

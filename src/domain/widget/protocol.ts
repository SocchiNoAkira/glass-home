export const WIDGET_PROTOCOL_VERSION = 1;
export const WIDGET_MAX_MESSAGE_BYTES = 64 * 1024;

export interface WidgetMessage<T = unknown> {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly messageId: string;
  readonly instanceId: string;
  readonly type: 'request' | 'response' | 'event' | 'error';
  readonly method: string;
  readonly payload: T;
  readonly timestamp: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface WidgetProbeRequest {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly type: 'widget-probe-request';
  readonly nonce: string;
}

export interface WidgetProbeResponse {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly type: 'widget-probe-response';
  readonly nonce: string;
  readonly payload: {
    readonly parentAccess: string;
    readonly extensionApiAccess: string;
    readonly userAgent: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isWidgetProbeRequest(value: unknown): value is WidgetProbeRequest {
  return (
    isRecord(value) &&
    value.protocolVersion === WIDGET_PROTOCOL_VERSION &&
    value.type === 'widget-probe-request' &&
    typeof value.nonce === 'string' &&
    value.nonce.length >= 12 &&
    value.nonce.length <= 128
  );
}

export function isWidgetProbeResponse(value: unknown): value is WidgetProbeResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== WIDGET_PROTOCOL_VERSION ||
    value.type !== 'widget-probe-response' ||
    typeof value.nonce !== 'string' ||
    value.nonce.length < 12 ||
    value.nonce.length > 128 ||
    !isRecord(value.payload) ||
    value.payload.parentAccess !== 'blocked' ||
    value.payload.extensionApiAccess !== 'blocked' ||
    typeof value.payload.userAgent !== 'string'
  ) {
    return false;
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= WIDGET_MAX_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

export function isWidgetMessage(value: unknown): value is WidgetMessage {
  return (
    isRecord(value) &&
    value.protocolVersion === WIDGET_PROTOCOL_VERSION &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    value.messageId.length <= 128 &&
    typeof value.instanceId === 'string' &&
    value.instanceId.length > 0 &&
    value.instanceId.length <= 128 &&
    ['request', 'response', 'event', 'error'].includes(String(value.type)) &&
    typeof value.method === 'string' &&
    value.method.length > 0 &&
    value.method.length <= 128 &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    'payload' in value
  );
}

import { WIDGET_MAX_MESSAGE_BYTES, WIDGET_PROTOCOL_VERSION } from './protocol';
import { isWidgetEnvironment, type WidgetEnvironment } from './environment';

/**
 * Sandbox widget bridge protocol (baseline 10.5, 10.6).
 *
 * Stage 3-C deliberately exposes **one read-only capability**: `environment.get`.
 * Network, notifications, bookmarks, geolocation and storage are not routed
 * here — an unauthenticated message channel that can reach the host is exactly
 * where a "just one more capability" becomes a sandbox escape.
 *
 * The envelope repeats the fields from `WidgetMessage` so a single validator
 * covers both transports, but every field is re-checked on the host side:
 * a widget may never authorise itself by claiming an instanceId.
 */

export const BRIDGE_METHODS = ['environment.get'] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export const BRIDGE_MAX_REQUESTS_PER_WINDOW = 20;
export const BRIDGE_RATE_WINDOW_MS = 1000;
export const BRIDGE_REQUEST_TIMEOUT_MS = 3000;

export const BRIDGE_ERROR_CODES = {
  unsupportedMethod: 'unsupported-method',
  payloadTooLarge: 'payload-too-large',
  rateLimited: 'rate-limited',
  instanceMismatch: 'instance-mismatch',
  protocolMismatch: 'protocol-mismatch',
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[keyof typeof BRIDGE_ERROR_CODES];

export interface BridgeRequest {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly type: 'request';
  readonly messageId: string;
  /** Cross-checked against the frame the session was opened for. */
  readonly instanceId: string;
  readonly method: BridgeMethod;
  readonly payload: unknown;
  readonly timestamp: number;
}

export interface BridgeResponse {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly type: 'response';
  readonly messageId: string;
  readonly instanceId: string;
  readonly method: BridgeMethod;
  readonly payload: WidgetEnvironment;
  readonly timestamp: number;
}

export interface BridgeError {
  readonly protocolVersion: typeof WIDGET_PROTOCOL_VERSION;
  readonly type: 'error';
  readonly messageId: string;
  readonly instanceId: string;
  readonly method: string;
  readonly error: { readonly code: BridgeErrorCode; readonly message: string };
  readonly timestamp: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown, max = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function fitsBudget(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= WIDGET_MAX_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

export function isBridgeMethod(value: unknown): value is BridgeMethod {
  return typeof value === 'string' && (BRIDGE_METHODS as readonly string[]).includes(value);
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!isRecord(value) || !fitsBudget(value)) return false;
  return (
    value.protocolVersion === WIDGET_PROTOCOL_VERSION &&
    value.type === 'request' &&
    isId(value.messageId) &&
    isId(value.instanceId, 160) &&
    isBridgeMethod(value.method) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    'payload' in value
  );
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (!isRecord(value) || !fitsBudget(value)) return false;
  return (
    value.protocolVersion === WIDGET_PROTOCOL_VERSION &&
    value.type === 'response' &&
    isId(value.messageId) &&
    isId(value.instanceId, 160) &&
    isBridgeMethod(value.method) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    isWidgetEnvironment(value.payload)
  );
}

export function isBridgeError(value: unknown): value is BridgeError {
  if (!isRecord(value) || !fitsBudget(value)) return false;
  const error = value.error;
  return (
    value.protocolVersion === WIDGET_PROTOCOL_VERSION &&
    value.type === 'error' &&
    isId(value.messageId) &&
    isId(value.instanceId, 160) &&
    typeof value.method === 'string' &&
    isRecord(error) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    error.message.length <= 200
  );
}

/** Framing used by the router; kept separate so the wire format stays stable. */
export function makeBridgeRequest(instanceId: string, method: BridgeMethod, messageId: string, payload: unknown = {}, now = Date.now()): BridgeRequest {
  return { protocolVersion: WIDGET_PROTOCOL_VERSION, type: 'request', messageId, instanceId, method, payload, timestamp: now };
}

export function makeBridgeResponse(request: BridgeRequest, payload: WidgetEnvironment, now = Date.now()): BridgeResponse {
  return {
    protocolVersion: WIDGET_PROTOCOL_VERSION, type: 'response',
    messageId: request.messageId, instanceId: request.instanceId,
    method: request.method, payload, timestamp: now,
  };
}

export function makeBridgeError(request: Pick<BridgeRequest, 'messageId' | 'instanceId'>, method: string, code: BridgeErrorCode, message: string, now = Date.now()): BridgeError {
  return {
    protocolVersion: WIDGET_PROTOCOL_VERSION, type: 'error',
    messageId: request.messageId, instanceId: request.instanceId,
    method, error: { code, message }, timestamp: now,
  };
}

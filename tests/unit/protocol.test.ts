import { describe, expect, it } from 'vitest';
import { WIDGET_PROTOCOL_VERSION, isWidgetProbeRequest, isWidgetProbeResponse } from '@/src/domain/widget/protocol';

const nonce = '018f2ee2-c51c-7f01-9a3c-111111111111';

describe('widget probe protocol', () => {
  it('accepts a valid one-time request', () => {
    expect(isWidgetProbeRequest({ protocolVersion: WIDGET_PROTOCOL_VERSION, type: 'widget-probe-request', nonce })).toBe(true);
  });

  it('rejects forged, stale-version and malformed requests', () => {
    expect(isWidgetProbeRequest({ protocolVersion: 2, type: 'widget-probe-request', nonce })).toBe(false);
    expect(isWidgetProbeRequest({ protocolVersion: 1, type: 'widget-probe-response', nonce })).toBe(false);
    expect(isWidgetProbeRequest({ protocolVersion: 1, type: 'widget-probe-request', nonce: 'short' })).toBe(false);
    expect(isWidgetProbeRequest(null)).toBe(false);
  });

  it('only accepts a response that proves both isolation boundaries', () => {
    const response = {
      protocolVersion: 1,
      type: 'widget-probe-response',
      nonce,
      payload: { parentAccess: 'blocked', extensionApiAccess: 'blocked', userAgent: 'test' },
    };
    expect(isWidgetProbeResponse(response)).toBe(true);
    expect(isWidgetProbeResponse({ ...response, payload: { ...response.payload, parentAccess: 'accessible' } })).toBe(false);
    expect(isWidgetProbeResponse({ ...response, payload: { ...response.payload, extensionApiAccess: 'accessible' } })).toBe(false);
  });
});

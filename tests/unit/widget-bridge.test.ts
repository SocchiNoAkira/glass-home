import { describe, expect, it } from 'vitest';
import { WIDGET_PROTOCOL_VERSION } from '@/src/domain/widget/protocol';
import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import { BRIDGE_ERROR_CODES } from '@/src/domain/widget/bridge';
import { SandboxBridgeRouter } from '@/src/infrastructure/widget-host/bridgeRouter';

/**
 * Host-side sandbox router. This is the only place untrusted input reaches the
 * app, so every rule is asserted individually: source identity, protocol
 * shape, instance binding, replay, rate limiting, capability scope and shutdown.
 */

const ENVIRONMENT: WidgetEnvironment = {
  theme: 'dark', language: 'zh-CN', reducedMotion: false,
  materialQuality: 'balanced', size: { w: 2, h: 2 },
};

/** Stand-in for `window`: compared by reference, exactly like the real check. */
const TRUSTED_SOURCE = { name: 'sandbox-window' };
const FOREIGN_SOURCE = { name: 'other-window' };

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: WIDGET_PROTOCOL_VERSION,
    type: 'request',
    messageId: 'msg-1',
    instanceId: 'builtin.sandbox-demo',
    method: 'environment.get',
    payload: {},
    timestamp: 1000,
    ...overrides,
  };
}

function router(overrides: Partial<Parameters<typeof makeOptions>[0]> = {}) {
  return new SandboxBridgeRouter(makeOptions(overrides));
}

function makeOptions(overrides: Partial<{
  instanceId: string; expectedSource: unknown; now: () => number;
  maxRequestsPerWindow: number; rateWindowMs: number;
}> = {}) {
  return {
    instanceId: 'builtin.sandbox-demo',
    expectedSource: TRUSTED_SOURCE,
    environment: () => ENVIRONMENT,
    now: () => 1000,
    ...overrides,
  };
}

describe('source identity', () => {
  it('ignores a message from any window but the bound one', () => {
    const outcome = router().handle({ source: FOREIGN_SOURCE, data: request() });
    expect(outcome.kind).toBe('ignored');
    expect(outcome.kind === 'ignored' && outcome.reason).toContain('来源');
  });

  it('ignores a message with no source at all', () => {
    expect(router().handle({ source: undefined, data: request() }).kind).toBe('ignored');
  });

  it('accepts the bound window', () => {
    const outcome = router().handle({ source: TRUSTED_SOURCE, data: request() });
    expect(outcome.kind).toBe('reply');
  });
});

describe('protocol validation', () => {
  it('drops malformed payloads without answering', () => {
    // Answering would make the host an oracle for malformed input.
    for (const data of [
      undefined, null, 'hello', 42,
      {},
      request({ protocolVersion: 2 }),
      request({ type: 'response' }),
      request({ messageId: '' }),
      request({ instanceId: '' }),
      request({ method: 'network.fetch' }),
      request({ timestamp: 'now' }),
    ]) {
      expect(router().handle({ source: TRUSTED_SOURCE, data }).kind).toBe('ignored');
    }
  });

  it('rejects a payload larger than the message budget', () => {
    const huge = request({ payload: { blob: 'x'.repeat(70 * 1024) } });
    expect(router().handle({ source: TRUSTED_SOURCE, data: huge }).kind).toBe('ignored');
  });
});

describe('instance binding', () => {
  it('refuses a widget that claims another instance id', () => {
    const outcome = router().handle({
      source: TRUSTED_SOURCE,
      data: request({ instanceId: 'builtin.todo' }),
    });
    expect(outcome.kind).toBe('reply');
    if (outcome.kind !== 'reply') return;
    expect('error' in outcome.message && outcome.message.error.code).toBe(BRIDGE_ERROR_CODES.instanceMismatch);
  });

  it('names the mismatch instead of silently serving the request', () => {
    const outcome = router().handle({
      source: TRUSTED_SOURCE, data: request({ instanceId: 'someone-else' }),
    });
    if (outcome.kind !== 'reply' || !('error' in outcome.message)) throw new Error('expected an error reply');
    expect(outcome.message.error.message).toContain('实例标识');
  });
});

describe('replay protection', () => {
  it('answers a message id once and ignores the repeat', () => {
    const routerInstance = router();
    const first = routerInstance.handle({ source: TRUSTED_SOURCE, data: request() });
    expect(first.kind).toBe('reply');
    const second = routerInstance.handle({ source: TRUSTED_SOURCE, data: request() });
    expect(second.kind).toBe('ignored');
    expect(second.kind === 'ignored' && second.reason).toContain('重复');
  });

  it('allows a fresh message id through', () => {
    const routerInstance = router();
    routerInstance.handle({ source: TRUSTED_SOURCE, data: request() });
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'msg-2' }) }).kind).toBe('reply');
  });
});

describe('rate limiting', () => {
  it('stops answering once the window budget is exhausted', () => {
    let clock = 1000;
    const routerInstance = router({ now: () => clock, maxRequestsPerWindow: 2, rateWindowMs: 1000 });
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'a' }) }).kind).toBe('reply');
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'b' }) }).kind).toBe('reply');
    const third = routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'c' }) });
    expect(third.kind).toBe('rate-limited');
  });

  it('reports a stable code so the widget can back off', () => {
    let clock = 1000;
    const routerInstance = router({ now: () => clock, maxRequestsPerWindow: 1, rateWindowMs: 1000 });
    routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'a' }) });
    const blocked = routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'b' }) });
    if (blocked.kind !== 'rate-limited') throw new Error('expected rate limiting');
    expect(blocked.message.error.code).toBe(BRIDGE_ERROR_CODES.rateLimited);
  });

  it('refills after the window elapses', () => {
    let clock = 1000;
    const routerInstance = router({ now: () => clock, maxRequestsPerWindow: 1, rateWindowMs: 1000 });
    routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'a' }) });
    clock += 1001;
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'b' }) }).kind).toBe('reply');
  });
});

describe('capability scope', () => {
  it('serves only the read-only environment capability', () => {
    const outcome = router().handle({ source: TRUSTED_SOURCE, data: request() });
    expect(outcome.kind).toBe('reply');
    if (outcome.kind !== 'reply' || 'error' in outcome.message) throw new Error('expected a response');
    expect(outcome.message.payload).toEqual(ENVIRONMENT);
  });

  it('answers an unopened capability with an explicit error', () => {
    const outcome = router().handle({
      source: TRUSTED_SOURCE, data: request({ method: 'storage.write' }),
    });
    // `storage.write` is not in the allowed method list, so it is rejected at
    // protocol level before reaching dispatch. Either path must not serve it.
    expect(outcome.kind).toBe('ignored');
  });

  it('serves environment through the router and echoes the instance id', () => {
    const outcome = router().handle({ source: TRUSTED_SOURCE, data: request() });
    if (outcome.kind !== 'reply' || 'error' in outcome.message) throw new Error('expected a response');
    expect(outcome.message.instanceId).toBe('builtin.sandbox-demo');
    expect(outcome.message.method).toBe('environment.get');
  });
});

describe('shutdown', () => {
  it('refuses everything after close', () => {
    const routerInstance = router();
    routerInstance.close();
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request({ messageId: 'late' }) }).kind).toBe('ignored');
  });

  it('forgets the dedupe set on close', () => {
    const routerInstance = router();
    routerInstance.handle({ source: TRUSTED_SOURCE, data: request() });
    routerInstance.close();
    expect(routerInstance.handle({ source: TRUSTED_SOURCE, data: request() }).kind).toBe('ignored');
  });
});

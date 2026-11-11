import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import { createSandboxSession, type SandboxSession } from '@/src/infrastructure/widget-host/sandboxSession';

/**
 * Sandbox demo panel (stage 3-C, dev-only surface).
 *
 * It exists to prove the host <-> sandbox channel in a real browser: the
 * iframe loads under the extension's `sandbox` CSP, cannot touch the parent
 * DOM, and may only ask the host for the read-only environment. The panel
 * shows what came back so a failure is visible instead of silent.
 */

const SANDBOX_PAGE = 'widget-probe.html';

export function SandboxDemo({ environment }: { readonly environment: Omit<WidgetEnvironment, 'size'> }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef<SandboxSession | undefined>(undefined);
  const [state, setState] = useState<'idle' | 'connected' | 'failed'>('idle');
  const [detail, setDetail] = useState<string>('尚未连接');

  // Depend on the individual values, not the object.
  //
  // The parent builds `environment` as a fresh object literal on every render,
  // so object identity changes whenever *any* settings state moves (a slider
  // drag, a widget-size refresh). Keying the session on identity tore the
  // channel down and rebuilt it mid-handshake: the iframe posts its
  // `environment.get` exactly once, so the rebuilt session never saw it and
  // the panel settled on "timed out".
  const { theme, language, reducedMotion, materialQuality } = environment;

  const connect = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // The session answers requests; it does not initiate them. The sandbox
    // sends `environment.get` once its own script has run.
    const session = createSandboxSession(frame, {
      instanceId: 'builtin.sandbox-demo',
      environment: () => ({ theme, language, reducedMotion, materialQuality, size: { w: 2, h: 2 } }),
      onGranted: (granted) => {
        setState('connected');
        setDetail(`已取得环境：${granted.theme === 'dark' ? '深色' : '浅色'} · ${granted.language} · ${granted.materialQuality}`);
      },
      onRefused: (reason) => {
        setState('failed');
        setDetail(`宿主拒绝：${reason}`);
      },
      onTimeout: () => {
        setState('failed');
        setDetail('沙箱未在时限内请求环境信息。');
      },
    });
    sessionRef.current?.dispose();
    sessionRef.current = session;
  }, [theme, language, reducedMotion, materialQuality]);

  // Attach the session *before* the frame can load.
  //
  // Previously the iframe carried `src` in JSX, so React started the load during
  // commit while the listener was still only attached in a later effect. The
  // sandbox posts its request once, so a load that won that race left the host
  // listening to nothing and the panel settled on "timed out". The src is now
  // assigned imperatively after the session exists.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    connect();
    frame.src = SANDBOX_PAGE;
    return () => {
      sessionRef.current?.dispose();
      sessionRef.current = undefined;
    };
  }, [connect]);

  return <div className="sandbox-demo">
    <h3>沙箱组件通道</h3>
    <p className="settings-note">开发示例：沙箱页无法访问父页面 DOM 与扩展 API，只能向宿主请求只读环境信息。宿主会校验消息来源、实例绑定与频率。</p>
    <div className="sandbox-demo__status" data-sandbox-state={state} role="status">
      {state === 'connected' ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
      <span>{detail}</span>
    </div>
    <iframe
      ref={frameRef}
      className="sandbox-demo__frame"
      /*
        Deliberately no `src` attribute here.
        React would start the load during commit, before the session's message
        listener is attached (that happens in the effect below) — the sandbox
        announces itself once, so a load that won that race lost its request. The
        effect assigns `frame.src` after the session exists. Setting it in both
        places also navigated twice per mount.
      */
      title="沙箱组件开发示例"
      // Same policy the extension declares in the manifest; keeping it inline
      // means the page is isolated even if it is loaded outside that context.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
  </div>;
}

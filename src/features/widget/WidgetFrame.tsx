import { Component, useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { WidgetEnvironment } from '@/src/domain/widget/environment';

/**
 * Widget host frame (baseline 10.10 "错误隔离").
 *
 * A widget is arbitrary UI: a render exception, a bad restore or a storage
 * failure must produce an error card inside its own grid cell, never a blank
 * page. The boundary wraps only the widget subtree, so the clock, search box,
 * icons and the layout engine keep working.
 *
 * The frame also owns the environment handoff and the visible/hidden signal a
 * widget needs to avoid doing work while scrolled out of view.
 */

interface ErrorBoundaryProps {
  readonly instanceId: string;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failure: { readonly message: string } | undefined;
  /** Bumped on retry so children remount instead of reusing a poisoned tree. */
  readonly attempt: number;
}

class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failure: undefined, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { failure: { message: error instanceof Error ? error.message : '组件渲染时发生未知错误。' } };
  }

  override componentDidCatch(error: unknown): void {
    // Console only: the payload never leaves the device and contains no user data.
    console.error(`[widget ${this.props.instanceId}] render failed`, error);
  }

  // A plain arrow field: not part of React.Component's surface, so no override.
  retry = (): void => {
    this.setState((state) => ({ failure: undefined, attempt: state.attempt + 1 }));
    this.props.onRetry();
  };

  override render(): ReactNode {
    if (this.state.failure) {
      return <WidgetErrorCard instanceId={this.props.instanceId} message={this.state.failure.message} onRetry={this.retry} />;
    }
    // The key change is what actually remounts the widget after a retry.
    return <div className="widget-frame__body" key={this.state.attempt}>{this.props.children}</div>;
  }
}

/** Error card that keeps the grid cell (baseline 10.10). */
export function WidgetErrorCard({ instanceId, message, onRetry }: {
  readonly instanceId: string;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="widget-error" role="alert" data-widget-error={instanceId}>
      <span className="widget-error__icon" aria-hidden="true"><AlertTriangle size={15} /></span>
      <div className="widget-error__text">
        <strong>组件暂时不可用</strong>
        <p>{message}</p>
      </div>
      {onRetry && <button type="button" className="widget-error__retry" onClick={onRetry} aria-label="重试加载组件"><RefreshCw size={12} /> 重试</button>}
    </div>
  );
}

export function WidgetFrame({ instanceId, environment, onRetry, children }: {
  readonly instanceId: string;
  readonly environment: WidgetEnvironment;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(true);

  // Baseline 10.6: widgets receive visibility so they can pause work. The
  // signal is exposed as a data attribute rather than a callback, because the
  // built-in widgets render synchronously and have nothing to subscribe to yet.
  useEffect(() => {
    const element = frameRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visibleRef.current = entry.isIntersecting;
        element.dataset.widgetVisible = entry.isIntersecting ? 'true' : 'false';
      }
    }, { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="widget-frame"
      data-widget-host={instanceId}
      data-widget-theme={environment.theme}
      data-widget-size={`${environment.size.w}x${environment.size.h}`}
      data-widget-reduced-motion={environment.reducedMotion ? 'true' : 'false'}
    >
      <WidgetErrorBoundary instanceId={instanceId} onRetry={() => onRetry?.()}>
        {children}
      </WidgetErrorBoundary>
    </div>
  );
}

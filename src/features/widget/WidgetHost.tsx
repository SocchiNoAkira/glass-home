import type { LayoutItem } from '@/src/domain/grid/model';
import type { Workspace } from '@/src/domain/workspace/model';
import type { WidgetEnvironment } from '@/src/domain/widget/environment';
import type { WidgetStorage } from '@/src/infrastructure/persistence/widgetStorage';
import { ClockWidget } from '@/src/features/clock/ClockWidget';
import { CalendarWidget } from '@/src/features/calendar/CalendarWidget';
import { SearchWidget } from '@/src/features/search/SearchWidget';
import { TodoWidget } from './TodoWidget';
import { WidgetFrame, WidgetErrorCard } from './WidgetFrame';

/**
 * Renders one built-in widget inside its host frame.
 *
 * Every built-in goes through the same frame so error isolation and the
 * environment handoff apply uniformly. An unknown instance id renders an error
 * card rather than nothing, because a silent empty cell looks like a layout bug.
 */

export interface WidgetHostProps {
  readonly item: LayoutItem;
  readonly workspace: Workspace;
  readonly environment: WidgetEnvironment;
  readonly storage: WidgetStorage | undefined;
  /** Bumps when widget data is cleared outside the widget, forcing a re-read. */
  readonly widgetDataVersion: number;
  readonly onWidgetError: (instanceId: string, message: string) => void;
}

export function WidgetHost({ item, workspace, environment, storage, widgetDataVersion, onWidgetError }: WidgetHostProps) {
  const instance = workspace.widgets.find((widget) => widget.instanceId === item.instanceId);

  /*
    `enabled: false` is checked *before* dispatching to an implementation.

    It used to be checked only after every built-in branch had already returned,
    which made it unreachable for the built-ins: the schema forbids unknown
    widget ids, so the trailing branch could never be reached. A backup carrying
    a disabled built-in therefore rendered it as fully working, contradicting the
    very flag the data model carries. Disabled instances keep their cell (the
    layout is untouched) but show why instead of pretending to work.
  */
  if (instance && !instance.enabled) {
    return <WidgetFrame instanceId={item.instanceId} environment={environment}>
      <WidgetErrorCard instanceId={item.instanceId} message="此组件已被禁用。" />
    </WidgetFrame>;
  }

  if (item.instanceId === 'builtin.clock') {
    return <WidgetFrame instanceId={item.instanceId} environment={environment}>
      <ClockWidget settings={workspace.settings} />
    </WidgetFrame>;
  }
  if (item.instanceId === 'builtin.search') {
    return <WidgetFrame instanceId={item.instanceId} environment={environment}>
      <SearchWidget settings={workspace.settings} />
    </WidgetFrame>;
  }
  if (item.instanceId === 'builtin.calendar') {
    return <WidgetFrame instanceId={item.instanceId} environment={environment}>
      <CalendarWidget settings={workspace.settings} />
    </WidgetFrame>;
  }
  if (item.instanceId === 'builtin.todo') {
    // Storage is opened by the app; until it is ready the widget must not mount,
    // otherwise its first read would race the connection and look like data loss.
    if (!storage || !instance) {
      return <WidgetFrame instanceId={item.instanceId} environment={environment}>
        <WidgetErrorCard instanceId={item.instanceId} message="组件存储尚未就绪，请稍后重试。" />
      </WidgetFrame>;
    }
    return <WidgetFrame instanceId={item.instanceId} environment={environment}>
      <TodoWidget
        instanceId={item.instanceId}
        namespace={instance.storageNamespace}
        storage={storage}
        dataVersion={widgetDataVersion}
        onError={(message) => onWidgetError(item.instanceId, message)}
      />
    </WidgetFrame>;
  }

  return <WidgetFrame instanceId={item.instanceId} environment={environment}>
    <WidgetErrorCard instanceId={item.instanceId} message="找不到这个组件的实现。" />
  </WidgetFrame>;
}

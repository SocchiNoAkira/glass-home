import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ListTodo, Trash2, X } from 'lucide-react';
import {
  EMPTY_TODO_STATE, TODO_MAX_ITEMS, TODO_MAX_TEXT_LENGTH, TODO_REJECTION_TEXT,
  addTodo, clearCompleted, parseTodoState, removeTodo, sortedTodos, todoSummary, toggleTodo,
  type TodoState,
} from '@/src/domain/widget/todo';
import type { WidgetStorage } from '@/src/infrastructure/persistence/widgetStorage';

/**
 * To-do widget (baseline 10.x). Data lives in the instance's own storage
 * namespace, never in the Workspace: ticking a checkbox must not bump the
 * layout revision or push an entry onto the layout undo stack.
 *
 * The component is a controlled editor over the pure domain functions in
 * `domain/widget/todo.ts`; persistence is the only side effect here.
 */

const STATE_KEY = 'state';

export type TodoStorageBridge = Pick<WidgetStorage, 'read' | 'write'>;

export function TodoWidget({ instanceId, storage, namespace, dataVersion = 0, onError }: {
  readonly instanceId: string;
  readonly storage: TodoStorageBridge;
  readonly namespace: string;
  /**
   * Bumped by the host whenever widget data is dropped outside this component
   * (e.g. "clear this widget's data" in settings). Without it the effect below
   * would keep the in-memory list and the cleared store would look unheard.
   */
  readonly dataVersion?: number;
  readonly onError?: (message: string) => void;
}) {
  const [state, setState] = useState<TodoState>(EMPTY_TODO_STATE);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string>();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // A widget must be able to rebuild itself from persisted state alone
  // (baseline 10.7), so everything is loaded before the first render commits.
  // `dataVersion` re-runs this after an outside clear, so the component never
  // keeps showing items that no longer exist on disk.
  useEffect(() => {
    let cancelled = false;
    void storage.read<unknown>(namespace, STATE_KEY)
      .then((stored) => {
        if (cancelled || !mountedRef.current) return;
        setState(parseTodoState(stored));
        setDraft('');
        setNotice(undefined);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        // Unreadable storage is not fatal: start from an empty list.
        setState(EMPTY_TODO_STATE);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [namespace, storage, dataVersion]);

  const persist = useCallback((next: TodoState) => {
    void storage.write(namespace, STATE_KEY, next).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '组件数据保存失败。';
      setNotice(message);
      onError?.(message);
    });
  }, [namespace, storage, onError]);

  /** Applies a domain result, persisting only when the operation was accepted. */
  const apply = useCallback((result: ReturnType<typeof addTodo>) => {
    if (!result.ok) {
      setNotice(TODO_REJECTION_TEXT[result.reason]);
      return false;
    }
    setState(result.state);
    setNotice(undefined);
    persist(result.state);
    return true;
  }, [persist]);

  const submit = () => {
    if (!apply(addTodo(state, draft, crypto.randomUUID()))) return;
    setDraft('');
    inputRef.current?.focus();
  };

  const items = sortedTodos(state);
  const summary = todoSummary(state);
  const atLimit = state.items.length >= TODO_MAX_ITEMS;

  return (
    <section
      className="grid-widget todo-widget glass-surface"
      aria-label="待办组件"
      data-widget-instance={instanceId}
      data-todo-count={summary.total}
      data-todo-remaining={summary.remaining}
      data-todo-loaded={loaded ? 'true' : 'false'}
    >
      <div className="widget__topline">
        <span className="widget__eyebrow"><ListTodo size={13} /> 待办</span>
        <span className="todo-widget__summary">{summary.remaining} 项未完成 · 共 {summary.total}</span>
      </div>

      {/* Enter submits; the input keeps its own arrow-key behaviour (7.3). */}
      <div className="todo-widget__composer">
        <label htmlFor={inputId} className="sr-only">新增待办</label>
        <input
          id={inputId}
          ref={inputRef}
          className="todo-widget__input"
          value={draft}
          maxLength={TODO_MAX_TEXT_LENGTH}
          disabled={atLimit}
          placeholder={atLimit ? `已达 ${TODO_MAX_ITEMS} 条上限` : '添加一条待办，回车保存'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Never let the grid's arrow/Esc handling see a composer keystroke.
            event.stopPropagation();
            submit();
          }}
        />
        <button
          className="mini-button todo-widget__add"
          onClick={submit}
          disabled={atLimit || draft.trim().length === 0}
          aria-label="添加待办"
          title="添加"
        ><Check size={14} /></button>
      </div>

      {items.length === 0 ? (
        <p className="todo-widget__empty" data-testid="todo-empty">
          {loaded ? '还没有待办。写下第一件事。' : '正在读取本地待办…'}
        </p>
      ) : (
        <ul className="todo-widget__list" aria-label="待办列表">
          {items.map((item) => (
            <li key={item.id} className={`todo-widget__item ${item.done ? 'is-done' : ''}`} data-todo-id={item.id}>
              {/* A real checkbox keeps the native keyboard and screen-reader path. */}
              <input
                type="checkbox"
                className="todo-widget__checkbox"
                checked={item.done}
                onChange={() => apply(toggleTodo(state, item.id))}
                aria-label={`完成 ${item.text}`}
              />
              <span className="todo-widget__text">{item.text}</span>
              <button
                className="todo-widget__remove"
                onClick={() => apply(removeTodo(state, item.id))}
                aria-label={`删除 ${item.text}`}
                title="删除"
              ><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="todo-widget__footer">
        <button
          className="todo-widget__clear"
          onClick={() => apply(clearCompleted(state))}
          disabled={summary.total === summary.remaining}
          aria-label="清除已完成"
        ><Trash2 size={11} /> 清除已完成</button>
      </div>

      {notice && <p className="todo-widget__notice" role="status">{notice}</p>}
    </section>
  );
}

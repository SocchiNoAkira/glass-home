import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';
import { openSafeUrl, resolveSearchDestination, SEARCH_ENGINES } from '@/src/domain/search/search';

export function SearchWidget({ settings, onChooseEngine }: {
  readonly settings: WorkspaceSettings;
  readonly onChooseEngine: () => void;
}) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const engine = settings.searchEngine === 'custom'
    ? { shortLabel: '自', label: '自定义' }
    : SEARCH_ENGINES[settings.searchEngine];

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination = resolveSearchDestination(query, settings);
    if (!destination.ok) {
      setMessage(destination.message);
      return;
    }
    setMessage('');
    openSafeUrl(destination.url, settings.openTarget);
  };

  return (
    <section className="grid-widget search-widget" aria-label="搜索组件">
      <form className="search-box glass-control" onSubmit={submit} role="search">
        <Search size={19} strokeWidth={1.7} />
        <input
          type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索或输入网址" aria-label="搜索或输入网址" autoComplete="off" spellCheck={false}
        />
        <button type="button" className="search-box__engine" onClick={onChooseEngine} aria-label={`搜索引擎：${engine.label}，点击更改`} title="更改搜索引擎">
          {engine.shortLabel}<ChevronDown size={13} />
        </button>
        <kbd>↵</kbd>
      </form>
      {message && <p className="search-message" role="alert">{message}</p>}
    </section>
  );
}

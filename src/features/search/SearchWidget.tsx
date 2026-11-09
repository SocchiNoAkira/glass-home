import { useState } from 'react';
import { Search } from 'lucide-react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';
import { openSafeUrl, resolveSearchDestination } from '@/src/domain/search/search';

export function SearchWidget({ settings }: {
  readonly settings: WorkspaceSettings;
}) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');

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
        {/*
          The engine badge used to sit here as a dropdown trigger. It competed
          with the input for attention and duplicated a control that only needs
          setting once, so it now lives solely in Settings → 搜索. The engine
          still drives the query; only the visible switch is gone.
        */}
        <kbd>↵</kbd>
      </form>
      {message && <p className="search-message" role="alert">{message}</p>}
    </section>
  );
}

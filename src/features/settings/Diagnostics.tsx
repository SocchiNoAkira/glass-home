import { useState } from 'react';

export function Diagnostics() {
  const [detail, setDetail] = useState('仅保留当前会话的本地运行状态，不上传诊断信息。');
  return <details className="diagnostics"><summary>本地运行说明</summary><p>{detail}</p><button className="button button--secondary button--small" onClick={() => setDetail(`页面协议：${window.location.protocol} · IndexedDB：${'indexedDB' in window ? '可用' : '不可用'} · 外部搜索建议：关闭`)}>查看当前环境</button></details>;
}

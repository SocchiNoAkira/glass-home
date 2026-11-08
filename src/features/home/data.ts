export interface ShortcutPrototype {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly initials: string;
  readonly color: string;
}

export const SHORTCUT_SEEDS: readonly ShortcutPrototype[] = [
  { id: 'github', name: 'GitHub', url: 'https://github.com', initials: 'GH', color: '#292c35' },
  { id: 'figma', name: 'Figma', url: 'https://www.figma.com', initials: 'F', color: '#ef7c63' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so', initials: 'N', color: '#f4f2ed' },
  { id: 'linear', name: 'Linear', url: 'https://linear.app', initials: 'L', color: '#7775e9' },
  { id: 'apple', name: 'Apple', url: 'https://www.apple.com.cn', initials: '', color: '#f0f0f2' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', initials: '▶', color: '#f34c51' },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', initials: 'M', color: '#edf1fc' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com', initials: '31', color: '#f2f4fb' },
  { id: 'vercel', name: 'Vercel', url: 'https://vercel.com', initials: '▲', color: '#e7e8ed' },
  { id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org', initials: 'M', color: '#242a3c' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', initials: 'AI', color: '#7bb9ac' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', initials: 'C', color: '#db9570' },
  { id: 'x', name: 'X', url: 'https://x.com', initials: '𝕏', color: '#23262d' },
  { id: 'dribbble', name: 'Dribbble', url: 'https://dribbble.com', initials: 'D', color: '#e774a5' },
  { id: 'translate', name: '翻译', url: 'https://translate.google.com', initials: '译', color: '#70a6e8' },
  { id: 'maps', name: '地图', url: 'https://maps.google.com', initials: '⌖', color: '#78bd9b' },
  { id: 'drive', name: '云端硬盘', url: 'https://drive.google.com', initials: '△', color: '#f2c36b' },
  { id: 'music', name: '音乐', url: 'https://music.apple.com', initials: '♫', color: '#ee718d' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org', initials: 'W', color: '#e4e2dd' },
  { id: 'reading', name: '稍后阅读', url: 'https://getpocket.com', initials: 'R', color: '#eb826d' },
];

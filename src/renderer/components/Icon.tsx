/** Small stroke icon set (24x24 grid). One component keeps every icon the same weight and size. */
const PATHS = {
  inbox: 'M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5zm0 0h5l1 3h6l1-3h5',
  journal: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4zm0 0v14M9 8h6M9 12h6',
  board: 'M3 5h18v14H3zM9 5v14M3 12h6M15 5v7',
  library: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tag: 'M3 12V4h8l10 10-8 8L3 12zm5-4h.01',
  highlight: 'M4 20h16M7 16l-1 4 4-1 9-9-3-3-9 9zM14 7l3 3',
  chat: 'M4 5h16v11H9l-5 4V5z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.5-4.5',
  command: 'M9 9V6a3 3 0 1 0-3 3h3zm0 0v6m0-6h6m-6 6v3a3 3 0 1 1-3-3h3zm0 0h6m0-6V6a3 3 0 1 1 3 3h-3zm0 0v6m0 0v3a3 3 0 1 0 3-3h-3z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6zm3 9v7',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
  trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  sync: 'M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4m2 2v-4h-4',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zm7 12l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  info: 'M12 11v6m0-10v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  toc: 'M4 6h16M4 12h10M4 18h13',
  location: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  task: 'M9 11l3 3 7-8M5 5h9M5 19h14',
  memo: 'M5 5h14v10l-4 4H5V5zM15 19v-4h4M8 9h8M8 13h4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  card: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 5h15',
  pdf: 'M6 3h8l5 5v13H6V3zm8 0v5h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  video: 'M4 6h12v12H4zM16 10l5-3v10l-5-3',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  file: 'M6 3h8l5 5v13H6V3zm8 0v5h5',
  text: 'M5 6h14M12 6v13M9 19h6',
  section: 'M3 5h18v14H3zM3 9h8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  mindmap: 'M5 12h4m6-6h4M15 18h4M9 12c3 0 3-6 6-6M9 12c3 0 3 6 6 6',
  select: 'M5 3l14 7-6 2-2 6L5 3z',
  upload: 'M12 16V4m0 0l-4 4m4-4l4 4M4 20h16',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5m5 5H10a6 6 0 0 0 0 12h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  minus: 'M5 12h14',
  check: 'M5 12l5 5 9-10',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  send: 'M4 12l16-8-6 16-3-6-7-2z',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  history: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2',
  export: 'M12 3v12m0-12l-4 4m4-4l4 4M5 14v6h14v-6',
  color: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3 9 9 0 0 0-8-11zM7.5 11h.01M10 7.5h.01M14.5 8h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  star: 'M12 4l2.4 5 5.6.7-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.7L12 4z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const KIND_ICON: Record<string, IconName> = {
  note: 'card',
  journal: 'journal',
  pdf: 'pdf',
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  highlight: 'highlight',
  web: 'globe',
  task: 'task',
  link: 'link',
  memo: 'memo',
};

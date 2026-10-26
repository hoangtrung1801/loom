import type { Tab } from '../../store/tabs.js';
import type { PanelId } from '../../store/ui.js';
import type { IconName } from '../Icon.js';

export const PANELS: Record<PanelId, { label: string; icon: IconName }> = {
  chat: { label: 'Chat', icon: 'chat' },
  library: { label: 'Card Library', icon: 'library' },
  suggestions: { label: 'Related cards', icon: 'sparkle' },
  journal: { label: 'Journal', icon: 'journal' },
  highlights: { label: 'Highlights', icon: 'highlight' },
  toc: { label: 'Table of contents', icon: 'toc' },
  info: { label: 'Info', icon: 'info' },
  location: { label: 'Whiteboard location', icon: 'location' },
  insight: { label: 'Insight', icon: 'star' },
  tasks: { label: 'To-dos', icon: 'task' },
};

/** Which side panels make sense for a tab, in button order. */
export function panelsFor(tab: Tab): PanelId[] {
  switch (tab.type) {
    case 'whiteboard': return ['chat', 'library', 'suggestions', 'highlights', 'toc', 'info'];
    case 'card': return ['chat', 'library', 'journal', 'highlights', 'toc', 'info', 'location', 'insight', 'tasks'];
    case 'tag': return ['chat', 'library', 'info'];
    case 'chat': return ['library'];
    case 'app': return tab.ref === 'journal' ? ['chat', 'library', 'tasks'] : ['chat', 'library'];
    default: return ['library'];
  }
}

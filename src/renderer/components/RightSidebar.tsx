import { activeTab, useTabs } from '../store/tabs.js';
import { useUi, type PanelId } from '../store/ui.js';
import { Icon } from './Icon.js';
import { ChatPanel } from './panels/ChatPanel.js';
import { HighlightsPanel } from './panels/HighlightsPanel.js';
import { InfoPanel } from './panels/InfoPanel.js';
import { InsightPanel } from './panels/InsightPanel.js';
import { JournalPanel } from './panels/JournalPanel.js';
import { LibraryPanel } from './panels/LibraryPanel.js';
import { LocationPanel } from './panels/LocationPanel.js';
import { PANELS, panelsFor } from './panels/registry.js';
import { SuggestionsPanel } from './panels/SuggestionsPanel.js';
import { TasksPanel } from './panels/TasksPanel.js';
import { TocPanel } from './panels/TocPanel.js';

function Body({ id }: { id: PanelId }) {
  const tab = useTabs((s) => activeTab(s));
  switch (id) {
    case 'chat': return <ChatPanel tab={tab} />;
    case 'library': return <LibraryPanel />;
    case 'suggestions': return <SuggestionsPanel tab={tab} />;
    case 'journal': return <JournalPanel />;
    case 'highlights': return <HighlightsPanel tab={tab} />;
    case 'toc': return <TocPanel tab={tab} />;
    case 'info': return <InfoPanel tab={tab} />;
    case 'location': return <LocationPanel tab={tab} />;
    case 'insight': return <InsightPanel tab={tab} />;
    case 'tasks': return <TasksPanel tab={tab} />;
  }
}

export function RightSidebar() {
  const panel = useUi((s) => s.panel);
  const setPanel = useUi((s) => s.setPanel);
  const tab = useTabs((s) => activeTab(s));
  if (!panel || !panelsFor(tab).includes(panel)) return null;
  return (
    <aside className="rightbar" aria-label={PANELS[panel].label}>
      <header className="rightbar-head">
        <Icon name={PANELS[panel].icon} />
        <h2 className="grow">{PANELS[panel].label}</h2>
        <button className="icon-btn" aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="close" /></button>
      </header>
      <div className="rightbar-body">
        <Body id={panel} />
      </div>
    </aside>
  );
}

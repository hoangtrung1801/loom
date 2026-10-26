import { openBoard } from '../../actions.js';
import type { Tab } from '../../store/tabs.js';
import { useData } from '../../store/data.js';
import { useCardDetail } from '../../store/edits.js';
import { Empty } from '../ui/bits.js';
import { Icon } from '../Icon.js';

/** Where this card lives: every whiteboard it is placed on. */
export function LocationPanel({ tab }: { tab: Tab }) {
  const { card } = useCardDetail(tab.type === 'card' ? tab.ref : null);
  const boards = useData((s) => s.boards);
  const list = card?.boards ?? [];
  return (
    <div className="panel">
      {list.length === 0 ? (
        <Empty title="Not on any whiteboard">Drag this card from the library onto a whiteboard.</Empty>
      ) : (
        <ul className="card-list">
          {list.map((b) => (
            <li key={b.id}>
              <button className="card-row" onClick={() => openBoard(b.id, tab.ref)}>
                <span className="title ellipsis"><Icon name="board" size={14} />{boards.find((x) => x.id === b.id)?.name || b.name || 'Untitled whiteboard'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { Insight } from '../../../core/ai/service.js';
import { api, errorMessage } from '../../api.js';
import { openCard } from '../../actions.js';
import { mutate, toast } from '../../store/data.js';
import type { Tab } from '../../store/tabs.js';
import { Empty } from '../ui/bits.js';
import { Button } from '@/components/ui/button';

/** AI-extracted key ideas for the open card. Each insight points back at the blocks it came from. */
export function InsightPanel({ tab }: { tab: Tab }) {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setInsights(null), [tab.ref]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    try {
      setInsights(await api.cardInsights(tab.ref));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const promote = async (i: Insight): Promise<void> => {
    const id = await mutate(() => api.promoteInsight({ cardId: tab.ref, text: i.text }));
    if (id) openCard(id, true);
  };

  return (
    <div className="panel insights">
      <Button disabled={busy} onClick={() => void generate()}>{busy ? 'Reading…' : insights ? 'Regenerate' : 'Find insights'}</Button>
      {insights && insights.length === 0 && <Empty title="No insights found">The card may be too short.</Empty>}
      <ul>
        {(insights ?? []).map((i, n) => (
          <li key={n}>
            <p>{i.text}</p>
            <div className="row">
              <button className="link" onClick={() => i.blockIds[0] && window.dispatchEvent(new CustomEvent('loom:scroll-block', { detail: i.blockIds[0] }))}>Show source</button>
              <button className="link" onClick={() => void promote(i)}>Save as card</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

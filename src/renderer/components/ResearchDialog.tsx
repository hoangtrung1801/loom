import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';

const RESEARCH_PROMPT = (topic: string): string =>
  `Research the topic "${topic}" using my notes. First search my cards and whiteboards for what I already know, then give me: ` +
  `1) a short summary of what my notes say (with citations), 2) gaps or open questions, 3) three concrete next steps. ` +
  `If I have little on this topic, say so plainly instead of guessing.`;

/** "Research a topic": hands a topic to the chat panel with a search over the user's own notes as context. */
export function ResearchDialog() {
  const open = useUi((s) => s.researchOpen);
  const setOpen = useUi((s) => s.setResearch);
  const openChat = useUi((s) => s.openChat);
  const [topic, setTopic] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  if (!open) return null;
  const close = (): void => setOpen(false);
  const start = (): void => {
    const t = topic.trim();
    if (!t) return;
    setTopic('');
    close();
    openChat([{ type: 'search', id: t, label: t }], null, RESEARCH_PROMPT(t));
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog research" role="dialog" aria-label="Research a topic" onSubmit={(e) => { e.preventDefault(); start(); }} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2><Icon name="sparkle" /> Research a topic</h2>
        <p className="hint">Loom searches your notes for the topic and asks the AI to summarize what you know, what is missing, and what to do next.</p>
        <input ref={input} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. spaced repetition" aria-label="Topic" />
        <div className="row"><button className="btn" type="button" onClick={close}>Cancel</button><button className="btn primary" type="submit" disabled={!topic.trim()}>Start research</button></div>
      </form>
    </div>
  );
}

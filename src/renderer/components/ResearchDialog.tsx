import { useState } from 'react';
import { useUi } from '../store/ui.js';
import { Icon } from './Icon.js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

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
  const close = (): void => setOpen(false);
  const start = (): void => {
    const t = topic.trim();
    if (!t) return;
    setTopic('');
    close();
    openChat([{ type: 'search', id: t, label: t }], null, RESEARCH_PROMPT(t));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-label="Research a topic" className="top-[12vh] translate-y-0">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <DialogHeader>
            <DialogTitle><Icon name="sparkle" /> Research a topic</DialogTitle>
            <DialogDescription>Loom searches your notes for the topic and asks the AI to summarize what you know, what is missing, and what to do next.</DialogDescription>
          </DialogHeader>
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. spaced repetition" aria-label="Topic" autoFocus />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!topic.trim()}>Start research</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

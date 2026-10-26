/**
 * What the editor needs from the rest of the app. The app fills this in at startup; keeping it behind an
 * interface means the editor never imports app state and can render inside a board node, a tab or a panel alike.
 */
export interface EditorEnv {
  /** Current title of a card, or undefined when unknown (mentions fall back to their stored label). */
  titleOf(cardId: string): string | undefined;
  openCard(cardId: string): void;
  /** Mention menu source. */
  searchCards(query: string): Promise<{ id: string; title: string }[]>;
  /** Creates a card from the mention menu's "create" row and returns its id. */
  createCard(title: string): Promise<string>;
  upload(file: File): Promise<string>;
  /** Called when a mention's title may have changed so nodeviews re-render. */
  subscribeTitles(fn: () => void): () => void;
  /** Surfaces failures (e.g. a rejected upload) without throwing into ProseMirror. */
  toast(message: string): void;
}

const noop: EditorEnv = {
  titleOf: () => undefined,
  openCard: () => undefined,
  searchCards: async () => [],
  createCard: async () => '',
  upload: async () => {
    throw new Error('Attachments are unavailable.');
  },
  subscribeTitles: () => () => undefined,
  toast: () => undefined,
};

export const editorEnv: EditorEnv = { ...noop };

export function configureEditor(env: Partial<EditorEnv>): void {
  Object.assign(editorEnv, env);
}

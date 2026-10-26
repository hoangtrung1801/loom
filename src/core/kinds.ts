/** Constants the renderer shares with the core. Kept free of Node imports so the browser bundle can use them. */
export type CardKind = 'note' | 'journal' | 'pdf' | 'image' | 'video' | 'audio' | 'file' | 'highlight' | 'web' | 'task' | 'link' | 'memo';
export const CARD_KINDS: readonly CardKind[] = ['note', 'journal', 'pdf', 'image', 'video', 'audio', 'file', 'highlight', 'web', 'task', 'link', 'memo'];

export const PROP_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url'] as const;
export type PropType = (typeof PROP_TYPES)[number];

/** Workflow of a task card, in board order. */
export const TASK_STATUSES = ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  'in-review': 'In review',
  done: 'Done',
  blocked: 'Blocked',
  'on-hold': 'On hold',
};
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Cards created before they had a status (or by other tools) count as "to do". */
export const statusOf = (status: string): TaskStatus => ((TASK_STATUSES as readonly string[]).includes(status) ? (status as TaskStatus) : 'todo');
export const priorityOf = (priority: string): TaskPriority => ((TASK_PRIORITIES as readonly string[]).includes(priority) ? (priority as TaskPriority) : 'medium');

/** Kinds whose text the user writes themselves, so they can be converted into each other. */
export const WRITTEN_KINDS: readonly CardKind[] = ['note', 'memo', 'task'];

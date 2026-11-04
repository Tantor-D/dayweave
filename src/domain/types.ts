export type Source = 'user' | 'web_ai' | 'harness' | 'external';
export type Target =
  'workspace' | 'long-term' | 'short-term' | `daily/${string}` | `notes/${string}`;
export type Placement =
  | { id: string; kind: 'day'; date: string }
  | { id: string; kind: 'timed'; startAt: string; endAt: string };
export interface Tag {
  id: string;
  name: string;
  color: string;
  colorPriority: number;
  order: number;
  archivedAt: string | null;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'done';
  parentId: string | null;
  tagIds: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  placements: Placement[];
}
export interface Workspace {
  schemaVersion: 3;
  revision: number;
  timezone: 'Asia/Shanghai';
  tags: Tag[];
  tasks: Task[];
}
export type Operation =
  | { type: 'tag.remove'; id: string }
  | { type: 'tag.create'; id?: string; name: string; color?: string; colorPriority?: number }
  | {
      type: 'tag.update';
      id: string;
      patch: Partial<Pick<Tag, 'name' | 'color' | 'colorPriority' | 'order' | 'archivedAt'>>;
    }
  | {
      type: 'task.create';
      id?: string;
      title: string;
      description?: string;
      parentId?: string | null;
      tagIds?: string[];
    }
  | {
      type: 'task.update';
      id: string;
      propagateTags?: boolean;
      patch: Partial<
        Pick<
          Task,
          'title' | 'description' | 'status' | 'parentId' | 'tagIds' | 'order' | 'archivedAt'
        >
      >;
    }
  | { type: 'placement.put'; taskId: string; placement: Placement }
  | { type: 'placement.remove'; taskId: string; id: string }
  | { type: 'text.write'; content: string };
export interface Snapshot<T = Workspace | string> {
  target: Target;
  data: T;
  hash: string | null;
  revision?: number;
  external?: { hash: string | null; content: string | null; valid: boolean; error?: string };
  readOnly?: string;
}
export interface PreviewInput {
  target: Target;
  baseHash: string | null;
  baseRevision?: number;
  operations: Operation[];
  summary?: string;
  dependsOn?: string[];
}
export interface Proposal {
  id: string;
  target: Target;
  baseHash: string | null;
  baseRevision?: number;
  operations: Operation[];
  summary: string;
  source: Source;
  before: string | null;
  after: string;
  createdAt: string;
  status: 'preview' | 'pending_confirmation' | 'applied' | 'conflict' | 'rejected' | 'failed';
  dependsOn?: string[];
  changeId?: string;
  error?: string;
  restoreOf?: string;
}
export interface Change {
  id: string;
  target: Target;
  before: string | null;
  after: string;
  beforeHash: string | null;
  afterHash: string;
  source: Source;
  approval: string;
  summary: string;
  createdAt: string;
  status: 'prepared' | 'committed' | 'aborted' | 'uncertain';
  requestId: string;
  proposalId?: string;
  restoreOf?: string;
  completionEvents: { taskId: string; title: string; completedAt: string }[];
}
export interface StatisticsPreferences {
  range: 'last30' | 'week' | 'month' | 'custom';
  startDate: string | null;
  endDate: string | null;
  tagId: string | null;
  hiddenCharts: ('duration' | 'first' | 'parallel' | 'tags' | 'selectedTag')[];
}
export interface Preferences {
  statistics: StatisticsPreferences;
  theme: 'glass-light' | 'glass-dark';
  days: 1 | 3 | 7;
  orientation: 'vertical' | 'horizontal';
  panelWidth: number;
  hiddenTags: string[];
  hiddenTasks: string[];
  hiddenStatuses: Task['status'][];
  showArchived: boolean;
  dayStart: number;
  dayEnd: number;
  inheritParentTags: boolean;
}
export interface ContextInput {
  startDate?: string;
  endDate?: string;
  taskIds?: string[];
  reflections?: Target[];
}
export interface ContextData {
  longTerm: Snapshot<string>;
  shortTerm: Snapshot<string>;
  workspace: Snapshot<Workspace>;
  reflections: Snapshot<string>[];
  scope: { taskIds: string[]; startDate?: string; endDate?: string };
}

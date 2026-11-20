/* What /api/agents sends (see src/server.js agentsPayload), as far as the pages read it. */

export type HostKind = 'tmux' | 'terminal' | 'editor' | 'app';

export interface Host {
  kind: HostKind;
  label: string;
  app?: string;
  tty?: string;
  session?: string;
  window?: string;
  windowName?: string;
  pane?: string;
}

export interface Transcript {
  title?: string | null;
  agentName?: string | null;
  lastPrompt?: string | null;
  lastReply?: string | null;
  activity?: string | null;
  gitBranch?: string | null;
  endState?: string | null;
  contextTokens?: number;
  lastActivityAt?: number;
}

export interface PromptOption {
  number: number;
  label: string;
  checked?: boolean;
  takesText?: boolean;
  amends?: boolean;
}

export interface ScreenPrompt {
  question?: string | null;
  options: PromptOption[];
  text?: string;
  tabs?: boolean;
  lastTab?: boolean;
  plan?: string | null;
  planFile?: string | null;
}

/** A switchyard task, by id and title; a subtask (such as a lead's worker) with its parent's id. */
export interface HubTaskRef { id: string; title: string; parentId?: string }
export interface TrackerTask { url?: string; name?: string; customId?: string | null }

export interface LiveSession {
  sessionId: string;
  pid: number;
  cwd: string;
  name?: string;
  nameIsCustom?: boolean;
  status: 'busy' | 'idle' | string;
  needsYou?: boolean;
  inBackground?: boolean;
  parked?: boolean;
  statusUpdatedAt: number;
  host?: Host | null;
  transcript?: Transcript;
  screenPrompt?: ScreenPrompt | null;
  hubTask?: HubTaskRef | null;
  stuckAt?: number | null;
  lastActivityAt?: number | null;
  contextHigh?: boolean;
  resumeCommand?: string;
}

export interface EndedSession {
  sessionId: string;
  cwd: string;
  endedAt: number;
  endState?: string;
  needsAttention?: boolean;
  repoName?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  prUrl?: string | null;
  prNumber?: number | null;
  hubTask?: HubTaskRef | null;
  task?: TrackerTask | null;
  transcript: Transcript;
  resumeCommand: string;
}

export interface Approval {
  id: string;
  sessionId: string;
  toolName: string;
  summary: string;
}

export interface WorktreePr { url: string; number: number }

export interface Worktree {
  path: string;
  branch?: string | null;
  pr?: WorktreePr | null;
  task?: TrackerTask | null;
  agents: { live: LiveSession[] };
}

export interface Repo {
  name: string;
  mainPath: string;
  worktrees: Worktree[];
}

export interface Capabilities {
  terminal?: string | null;
  tmux?: boolean;
  editorScheme?: string | null;
  approvalsHook?: boolean;
}

export interface NavCount { count: number; tone?: string; [key: string]: number | string | undefined }
export type Nav = Record<string, NavCount>;

export interface TaskStart { path: string; state: string; trust?: unknown; detail?: string | null }

export interface AgentsData {
  generatedAt: number;
  liveSessions: LiveSession[];
  endedSessions: EndedSession[];
  endedHistoryDays: number;
  approvals: Approval[];
  repos: Repo[];
  capabilities: Capabilities;
  errors: { source: string; message: string }[];
  nav?: Nav;
  taskStarts?: TaskStart[];
}

/** A line describing a session (see public/session-text.js sessionDetail). */
export interface Detail {
  kind: string;
  label?: string | null;
  text: string;
  full?: string;
}

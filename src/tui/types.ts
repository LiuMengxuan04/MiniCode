export type TranscriptEntry =
  | {
      id: number
      kind: 'user'
      body: string
    }
  | {
      id: number
      kind: 'assistant'
      body: string
    }
  | {
      id: number
      kind: 'progress'
      body: string
    }
  | {
      id: number
      kind: 'tool'
      toolName: string
      status: 'running' | 'success' | 'error'
      body: string
      collapsed?: boolean
      collapsedSummary?: string
      collapsePhase?: 1 | 2 | 3
    }
  | {
      id: number
      kind: 'task_update'
      action: 'created' | 'updated' | 'completed'
      taskSummary: string
    }

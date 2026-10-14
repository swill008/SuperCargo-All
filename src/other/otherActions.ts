/** Overlay -> main window job actions, relayed by main (rule 8: only the main window writes jobs). */
export type OtherAction =
  | { type: 'toggleStep'; jobId: string; stepId: string }
  | { type: 'complete'; jobId: string }
  | { type: 'abandon'; jobId: string }

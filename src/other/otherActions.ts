/** Overlay -> main window job actions, relayed by main (rule 8: only the main window writes jobs). */
export type OtherAction =
  | { type: 'toggleStep'; jobId: string; stepId: string }
  | { type: 'complete'; jobId: string }
  | { type: 'abandon'; jobId: string }
  /** batch 19: PLAN ROUTE / RE-PLAN from the overlay (jobId ''); the main window plans and saves */
  | { type: 'planRoute'; jobId: string }

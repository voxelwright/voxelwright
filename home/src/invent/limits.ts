// The mechanic sandbox's limits (#106), one owner for both sides: the worker enforces them on
// the code, the relay and the page on what comes back. No imports, so each side can read it.
export const LIMITS = {
  /** Bytes the interpreter may hold: code, objects and the view it is handed. */
  memory: 8 * 1024 * 1024,
  /** Bytes of interpreter stack. */
  stack: 96 * 1024,
  /** Interrupt asks per call (the interpreter asks about every ten thousand jumps and calls), and for loading. */
  budget: 40,
  maxBudget: 200,
  loadBudget: 200,
  /** Characters of mechanic code. */
  code: 12_000,
  /** Characters of one view, and of one answer. */
  view: 48_000,
  answer: 32_000,
  /** Characters of a reason said back. */
  reason: 160,
  /** A call unanswered after this long (ms) means the sandbox is stuck: it is closed. */
  late: 1500,
  /** Starting the frame and loading the code may take this long (ms). */
  start: 10_000,
} as const

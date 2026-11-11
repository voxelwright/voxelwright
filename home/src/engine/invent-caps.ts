// The limits on an invented mechanic (#106), one owner: the engine enforces them (invent.ts), and the
// host quotes them to the model. No imports, so the host can read it as it is.
export const INVENT = {
  /** Knobs a kind may declare (the gadget registry's own limit). */
  knobs: 3,
  /** Gadgets of the new kind in one toy: each is one more call per step in the sandbox. */
  gadgets: 4,
  /** Moving things shown per view. */
  things: 96,
  /** Commands applied per answer; the rest are dropped and counted. */
  commands: 64,
  /** Touches and signals passed on per gadget per view. */
  events: 16,
  /** Numbers a gadget's state may hold. */
  state: 16,
  /** The most one push may add, N·s. */
  impulse: 20,
  /** Failed answers in a row before the mechanic is stopped. */
  strikes: 3,
  /** Characters a gadget may show on its part. */
  show: 12,
  /** Inputs, and outputs, a kind may declare. */
  ports: 4,
  /** Characters of one view; a longer one goes without the home's places, or not at all. */
  view: 48_000,
  /** The longest a view's `h` gets when views were skipped, s. */
  h: 0.1,
  /** The home's places are read again this often (simulated s) and sent when they changed: a named thing may have moved. */
  places: 0.5,
}

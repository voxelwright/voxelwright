// Shared human / AI agent control lease for a game session (#98).
// Modeled directly on T3 Code's apps/server/src/preview/SessionControl.ts:
// - `observe()` runs without queueing or ownership so agents can inspect while a human plays.
// - `agent(agentId, fn)` requires an unclaimed session or ownership by `agentId`, and no human in control.
// - The instant the human takes control (clicking Take Control or touching WASD/mouse/gamepad),
//   `epoch` increments so queued/stale agent mutations fail cleanly with `humanControl` instead of fighting input.

export class GameControlInterruptedError extends Error {
  constructor(message, reason = 'interrupted') {
    super(message)
    this.name = 'GameControlInterruptedError'
    this.reason = reason
  }
}

const settle = (p) => Promise.resolve(p).then(() => undefined, () => undefined)

export class SessionControl {
  #agentId
  #onChange
  #tail = Promise.resolve()
  #pending = Promise.resolve()
  #owner = null // null (unclaimed/agent-ready) | 'human' | string (human viewer id)
  #epoch = 0
  #closed = false
  #lastHumanActivityAt = 0

  constructor({ agentId = null, humanControlled = false, onChange = () => {} } = {}) {
    this.#agentId = agentId
    this.#owner = humanControlled ? 'human' : null
    this.#onChange = onChange
  }

  get agentId() { return this.#agentId }
  get owner() { return this.#owner }
  get generation() { return this.#epoch }
  get closed() { return this.#closed }
  get lastHumanActivityAt() { return this.#lastHumanActivityAt }

  status() {
    return {
      owner: this.#owner,
      agentId: this.#agentId,
      generation: this.#epoch,
      closed: this.#closed,
      humanInControl: this.#owner !== null,
      lastHumanActivityAt: this.#lastHumanActivityAt || null,
    }
  }

  #assertOpen() {
    if (this.#closed) throw new GameControlInterruptedError('This game session is closed.', 'closed')
  }

  #changeOwner(nextOwner) {
    if (this.#owner === nextOwner) return
    this.#owner = nextOwner
    this.#epoch++
    this.#onChange(this.status())
  }

  #enqueue(run) {
    const result = this.#tail.then(run)
    this.#tail = result.then(() => this.#pending, () => this.#pending)
    return result
  }

  track(work) {
    this.#pending = Promise.all([this.#pending, settle(work)]).then(() => undefined)
  }

  /** Claims the session for an agent if currently unclaimed and not human-controlled. */
  claimAgent(agentId) {
    this.#assertOpen()
    if (this.#owner !== null) {
      throw new GameControlInterruptedError('A human currently controls this game session.', 'humanControl')
    }
    if (this.#agentId !== null && this.#agentId !== agentId) {
      throw new GameControlInterruptedError(`This game session is owned by another agent (${this.#agentId}).`, 'agentMismatch')
    }
    if (this.#agentId !== agentId) {
      this.#agentId = agentId
      this.#epoch++
      this.#onChange(this.status())
    }
    return this.status()
  }

  releaseAgent(agentId) {
    if (this.#agentId === agentId || agentId === '*') {
      this.#agentId = null
      this.#epoch++
      this.#onChange(this.status())
    }
    return this.status()
  }

  agentMayAct(agentId) {
    return this.#agentId === null || this.#agentId === agentId
  }

  agentCanActNow(agentId) {
    return !this.#closed && this.#owner === null && this.agentMayAct(agentId)
  }

  /** Non-blocking read: works even while a human is driving. */
  observe(run) {
    this.#assertOpen()
    return Promise.resolve().then(run)
  }

  /** Serialized mutating action on behalf of an agent. */
  agent(agentId, run, deadlineMs) {
    this.#assertOpen()
    if (!this.agentMayAct(agentId)) {
      return Promise.reject(new GameControlInterruptedError('This game session belongs to another agent.', 'agentMismatch'))
    }
    if (this.#owner !== null) {
      return Promise.reject(new GameControlInterruptedError('A human controls this game session. Release control or spawn a headless session.', 'humanControl'))
    }
    const epoch = this.#epoch
    return this.#enqueue(async () => {
      this.#assertOpen()
      if (epoch !== this.#epoch || this.#owner !== null || !this.agentMayAct(agentId)) {
        throw new GameControlInterruptedError('Game control changed before the action could run. Take a fresh snapshot.', 'interrupted')
      }
      if (deadlineMs !== undefined && performance.now() >= deadlineMs) {
        throw new GameControlInterruptedError('Game action timed out waiting in queue.', 'timeout')
      }
      return run()
    })
  }

  /** Immediate human takeover (button press or live WASD/mouse/gamepad input). */
  takeHuman(viewerId = 'human') {
    this.#assertOpen()
    this.#lastHumanActivityAt = Date.now()
    if (this.#owner !== viewerId) this.#changeOwner(viewerId)
    return this.status()
  }

  /** Human hands control back so agents may drive again. */
  async releaseHuman(viewerId = 'human') {
    this.#assertOpen()
    if (this.#owner !== null && this.#owner !== viewerId && viewerId !== '*') {
      throw new GameControlInterruptedError('Only the controlling viewer can release control.', 'interrupted')
    }
    this.#changeOwner(null)
    await this.#enqueue(async () => {})
    return this.status()
  }

  async close() {
    if (!this.#closed) {
      this.#closed = true
      this.#owner = null
      this.#epoch++
      this.#onChange(this.status())
    }
    await this.#tail
  }
}

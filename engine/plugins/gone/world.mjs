// `world.gone(id)`: an actor of the rule's leaves (#264). It was a line of world.mjs; it is here as the proof that
// the plugin form carries what the engine already had. One that was a resident of the town is let go and walks
// back to its round (#218); any other is simply no longer there.
export default ({ folk, tell, release }) => ({
  does: {
    gone(rule, w) {
      const p = folk.get(`${rule.id}/${w.id}`)
      if (p?.rule !== rule.id) return
      if (p.was !== undefined) release(p)
      else { folk.delete(p.by); p.gone = true; tell(p) }
    },
  },
})

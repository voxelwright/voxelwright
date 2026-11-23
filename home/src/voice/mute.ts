// Sound switches shared by the voices (plugins/babble.ts) and the music (plugins/music.ts).
// `M` and the felt speaker button mute everything and keep it under one key; the music
// has a second switch of its own, so a person can keep the voices and lose the bed.

/** All sound: the villagers' voices and the music. Kept under its first name, since the voices came first. */
export const ALL_MUTED = 'village.babble.muted'
/** The music alone (Shift+M or the note beside the speaker). */
export const MUSIC_MUTED = 'village.music.muted'

export function storedFlag(key: string, fallback = false): boolean {
  try {
    const value = localStorage.getItem(key)
    if (value === '1' || value === '0') return value === '1'
  } catch {
    // Storage may be unavailable.
  }
  return fallback
}

export function storeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // Private windows may refuse storage; the switch still works for this visit.
  }
}

/** Typing in the slip or the notebook never toggles the sound. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

/** The `M` key on its own (not Shift+M, which is the music's) with no other modifier, repeat or text field. */
export function isMuteKey(e: KeyboardEvent, shifted: boolean): boolean {
  return e.key.toLowerCase() === 'm' && e.shiftKey === shifted && !(e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target))
}

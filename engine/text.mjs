// Text that someone typed, or that a model or a rule wrote (#218, #264): the one place that says how it may be
// shown and told. No control characters, no line or paragraph separators, and no longer than asked.
export const text = (v, most) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, most) : '')

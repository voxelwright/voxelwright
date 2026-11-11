declare module 'virtual:prop-box' {
  /** The prop sandbox worker as one script (#42, dev only; see vite.config.ts). */
  const source: string
  export default source
}

declare module 'virtual:mechanic-box' {
  /** The mechanic sandbox worker as one script (#106; see vite.config.ts). */
  const source: string
  export default source
}

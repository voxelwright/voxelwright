// Servers (#526): the list of lobbies a master server knows, joining one, being in one, and an admin's controls. The
// old server browser: a table of servers sorted as you like and refreshed by hand and quietly, a row picked and joined,
// a password asked where a server has one, a private server joined by its code, and an admin's commands as controls.
// Fetched the first time it is needed (the realm's settings key, a join under way, a page in a lobby): nothing of it is
// in the bytes before then.
//
// A join loads the page again. Everything this page builds round the world it is in (main.ts: the mover, presence,
// the person, the realms) is built once, at the start, by whether it is its own world or one reached through a door, so
// the chosen lobby goes into a ticket this tab keeps (`TICKET`, sessionStorage: never the address, so a link someone
// shares takes nobody anywhere) that main.ts takes and forgets as it starts, within a minute of its writing. The
// password never goes in it: it is asked here once the page has started again, given to the door's hello
// (door.ts `enter`) and dropped. Leaving loads the page again without one.
//
// What holds:
//   - A lobby's name and about, a player's name and what a server says are text strangers typed: set as text
//     (`textContent`, never markup, never a link), cut to a length, everywhere they are shown, a key's name included.
//   - A password is in its own field while it is typed, in the hello, and nowhere else: not the address, the DOM's text,
//     storage, a log or an error. The admin's the same, in `admin()`.
//   - Admin controls are built once the server has said yes to the admin's password, and not before.
//   - The list holds at most ROWS_MOST rows, and says when the master had more; it is asked at most every QUIET ms
//     while open and seen, and waits as long as the master says (429, Retry-After).
//
// The panel is the Voxelmorphism kit's dialog (engine/kit), as connect.ts's is: plain HTML first, voxels when the kit
// draws them.
import { asked, enter, notice, Refused, type Door, type Stage, type Why } from './door.ts'
import { where } from './bay.ts'
import { legends } from './typeface.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'

/** Where the lobby a join chose waits while the page loads again (main.ts takes it): this tab's, never the address. */
export const TICKET = 'village.join'
/** The name a visitor goes by, kept in this browser (presence.ts reads the same). */
const NAME = 'village.name'
/** The most rows the list holds: the master's pages (of its own size) asked for one after another until then. */
const ROWS_MOST = 1000
/** How often the list is asked again while it is open and seen, ms. */
const QUIET = 30_000
/** How often who is here is asked while in a lobby, ms. */
const PEOPLE_EVERY = 4000

type Kit = { adopt(root?: Element): void; refresh?(el: Element): void }
interface Row { id: string; name: string; about: string; players: number; most: number; locked: boolean; since: number }
export interface Seam { master: string; hud: Hud; input: Input; door: Door | null }
type View = 'list' | 'joining' | 'here' | 'admin' | 'host' | 'out'
type Key = 'name' | 'players' | 'locked' | 'since'

/** The master's address as this page may use it: http or https, no credentials, or null (the preview takes it from the address, local.ts). */
const masterOf = (master: string) => { const u = URL.parse(master); return u && (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? u.href.replace(/\/$/, '') : null }
/** A word for a POSIX shell, in single quotes: whatever it holds is one argument, never a command. */
const quoted = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`
/** Text someone typed, as it may be shown: no control or direction-turning characters, at most `most` characters. */
const plain = (v: unknown, most: number) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, most)
const releaseOf = (pin: string) => (pin === 'town' ? 'the generated town' : `release ${pin.slice(0, 12)}`)
/** How long a server has been up: in words, or as short as a phone's column takes. */
const upFor = (since: number, short = false) => {
  const s = Math.max(0, Date.now() / 1000 - since)
  return s < 60 ? (short ? 'now' : 'just now') : s < 3600 ? `${Math.floor(s / 60)}${short ? 'm' : ' min'}` : s < 86400 ? `${Math.floor(s / 3600)}${short ? 'h' : ' h'}` : `${Math.floor(s / 86400)}${short ? 'd' : ' d'}`
}
const named = () => { try { return localStorage.getItem(NAME) ?? '' } catch { return '' } }
const keepName = (name: string) => { try { if (name) localStorage.setItem(NAME, name); else localStorage.removeItem(NAME) } catch { /* a window that keeps nothing */ } }

/** What a refusal says, and what to do next. */
function said(why: Why, o: { message?: string; wait?: number; pin?: string } = {}): [string, string] {
  const wait = o.wait ? ` Wait ${o.wait} s.` : ''
  switch (why) {
    case 'master': return ['The server list is not answering.', 'Check your connection and try again in a moment. You can keep playing in your own world.']
    case 'slow': return [`The server list asks this page to slow down.${wait}`, 'Try again in a minute.']
    case 'gone': return ['That server is gone: its host stopped it, or it lost its line to the master.', 'Refresh the list and pick another.']
    case 'pin': return [`That server runs another version of the city${o.pin && o.pin !== 'town' ? ` (${releaseOf(o.pin)})` : ''}.`, 'Pick a server on this version, or ask its host for a link to the page they play on.']
    case 'busy': return ['The server is busy letting others in.', 'Try again in a moment.']
    case 'silent': return ['The host did not answer.', 'Their machine may be asleep or offline. Try again later, or pick another.']
    case 'network': return ['No line to the host could be opened.', 'One of the two networks lets no direct connection through, as some offices and phone networks do. Try another network, or another server.']
    case 'full': return ['The server is full.', 'Try again when someone leaves, or pick another.']
    case 'banned': return ['You are banned from this server.', 'Pick another server.']
    case 'password': return ['This server asks for a password, and none was given.', 'Ask its host for it, then join again.']
    case 'wrong': return ['That password was wrong.', 'Try again, or ask its host for it.']
    case 'tries': return [`Too many wrong passwords.${wait}`, 'Then try again.']
    default: return [`The server did not let this page in${o.message ? `: “${plain(o.message.replace(/^.*?: /, ''), 160)}”` : ''}.`, 'Pick another, or try again later.']
  }
}

const STYLE = /* css */ `
#lobbies { color: var(--vx-ink); font: 400 15px/1.5 var(--vx-font, system-ui, sans-serif); inline-size: min(calc(100vw - 32px), 680px); box-sizing: border-box; }
#lobbies[open] { display: flex; flex-direction: column; }
#lobbies[data-view="admin"] { inline-size: min(calc(100vw - 32px), 720px); }
#lobbies:is([data-view="joining"], [data-view="out"]) { inline-size: min(calc(100vw - 32px), 500px); }
#lobbies[data-view="joining"]::backdrop { background: rgb(8 9 15 / 0.72); }
/* More below what is seen: an edge of shade at the foot of the body, which stays where it is as the body scrolls. */
#lobbies .vx-dialog-body { scrollbar-width: thin; scrollbar-color: var(--vx-steel) transparent; }
#lobbies .vx-dialog-body[data-more] { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 56px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 56px), transparent); }
#lobbies .vx-dialog-body[data-less] { -webkit-mask-image: linear-gradient(to top, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(to top, #000 calc(100% - 40px), transparent); }
#lobbies .vx-dialog-body[data-more][data-less] { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 40px, #000 calc(100% - 56px), transparent); mask-image: linear-gradient(to bottom, transparent, #000 40px, #000 calc(100% - 56px), transparent); }
#lobbies { margin: auto; max-block-size: min(calc(100dvh - 32px), calc(var(--seen, 100dvh) - 24px)); }
@media (pointer: coarse) { #lobbies { margin-block-start: calc(env(safe-area-inset-top, 0px) + 16px); max-block-size: calc(var(--seen, 100dvh) - env(safe-area-inset-top, 0px) - 28px); } }
#lobbies > header { flex: none; display: flex; align-items: baseline; gap: 12px; }
#lobbies > header .sub { font-weight: 500; font-size: 14px; opacity: 0.8; }
#lobbies .vx-dialog-body { flex: 1 1 auto; min-block-size: 0; display: grid; gap: calc(var(--vx) * 4); align-content: start; padding-block-end: calc(var(--vx) * 7); }
#lobbies > footer { flex: none; align-items: center; padding-block-start: calc(var(--vx) * 6); margin-inline: calc(var(--vx) * 2); border-block-start: var(--vx) solid color-mix(in oklab, var(--vx-steel) 45%, transparent); }
#lobbies > footer .gap { margin-inline-end: auto; }
/* A phone held upright: the keys share rows, the main one last on the right, the one that leads elsewhere (Host, Leave) a row of its own under them. */
@media (max-width: 480px) {
  #lobbies > footer { flex-wrap: wrap; row-gap: calc(var(--vx) * 5); column-gap: calc(var(--vx) * 4); padding-block-end: calc(var(--vx) * 7); }
  #lobbies > footer .vx-button { flex: 1 1 auto; justify-content: center; white-space: nowrap; }
  #lobbies > footer .gap { order: 2; flex-basis: 100%; margin-inline-end: 0; }
  #lobbies > footer .k-leave { order: 0; flex-basis: auto; }
  #lobbies .up-long { display: none; }
}
@media (min-width: 481px) { #lobbies .up-short { display: none; } }
#lobbies [hidden] { display: none !important; }
#lobbies section { display: grid; gap: calc(var(--vx) * 4); min-inline-size: 0; }
#lobbies p { margin: 0; }
#lobbies h3 { margin: 0; font: 600 13px/1.2 var(--vx-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#lobbies .truth { color: var(--vx-ink-quiet); font-size: 14px; }
#lobbies .truth b { color: var(--vx-ink); font-weight: 600; }
#lobbies .line { font-weight: 600; min-block-size: 1.5em; }
#lobbies .line:empty { display: none; }
#lobbies .line[data-tone="bad"] { color: var(--vx-danger-text, #b3261e); }
#lobbies .line[data-tone="quiet"] { color: var(--vx-ink-quiet); font-weight: 400; }
#lobbies .next { color: var(--vx-ink-quiet); }
#lobbies .next:empty { display: none; }
/* 16 px: under that Safari zooms the page to the field. */
#lobbies .vx-well input { font-size: 16px; }
/* A key beside a well: its solid stands up and to the left of its face by half its height (SPEC 3), so a gutter clear of the well's wall. */
#lobbies .key { display: flex; gap: calc(var(--vx) * 5); align-items: stretch; }
#lobbies .key .vx-well { flex: 1; min-inline-size: 0; }
#lobbies .key .vx-button { flex: none; }
/* The list: the kit's table (words, one groove under the head), its heads pressed to sort, a row picked. */
#lobbies .bar { display: flex; align-items: center; gap: calc(var(--vx) * 3); }
@media (max-width: 480px) { #lobbies .bar { flex-wrap: wrap; } #lobbies .bar .count { flex: 1 1 100%; } #lobbies .bar .refresh { margin-inline-start: auto; } }
#lobbies .bar .count { margin-inline-end: auto; color: var(--vx-ink-quiet); font-size: 14px; font-variant-numeric: tabular-nums; }
#lobbies .vx-table-scroll { max-block-size: min(46vh, calc(var(--vx) * 90)); overflow: auto; overscroll-behavior: contain; }
@media (max-height: 560px) { #lobbies .vx-table-scroll { max-block-size: 34vh; } }
#lobbies table { inline-size: 100%; border-collapse: collapse; table-layout: fixed; }
#lobbies thead th { position: sticky; top: 0; z-index: 1; background: var(--vx-chalk); padding-block: 0; vertical-align: middle; }
#lobbies thead th.n { inline-size: 5.5em; }
#lobbies thead th.l { inline-size: 7.5em; }
#lobbies thead th.u { inline-size: 6em; }
#lobbies .h-short { display: none; }
#lobbies .sort .lock { margin: 0; }
@media (max-width: 480px) { #lobbies thead th.n { inline-size: 4em; } #lobbies thead th.l { inline-size: 3em; } #lobbies thead th.u { inline-size: 3.6em; } #lobbies thead .sort { min-inline-size: 0; } #lobbies .h-long { display: none; } #lobbies .h-short { display: inline-block; } #lobbies tbody .full-word { display: block; margin: 0; } #lobbies .lock-word { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } }
#lobbies .sort { display: inline-flex; align-items: center; gap: calc(var(--vx) * 1.5); box-sizing: border-box; min-inline-size: calc(var(--vx) * 11); block-size: calc(var(--vx) * 11); margin: 0; padding: 0; border: 0; border-radius: 0; background: none; font: inherit; font-weight: 600; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vx-ink-quiet); cursor: pointer; }
#lobbies .vx-num > .sort { justify-content: flex-end; inline-size: 100%; }
#lobbies .sort:hover, #lobbies [aria-sort] > .sort { color: var(--vx-ink); }
#lobbies .sort:focus-visible { outline: 2px solid var(--vx-focus); outline-offset: calc(var(--vx) * -1); }
#lobbies .sort::after { content: ""; flex: none; inline-size: calc(var(--vx) * 2.5); block-size: calc(var(--vx) * 3.5); background: currentColor; opacity: 0.45;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 7' shape-rendering='crispEdges'%3E%3Cpath d='M2 0h1v1H2zM1 1h3v1H1zM0 2h5v1H0zM0 4h5v1H0zM1 5h3v1H1zM2 6h1v1H2z'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 7' shape-rendering='crispEdges'%3E%3Cpath d='M2 0h1v1H2zM1 1h3v1H1zM0 2h5v1H0zM0 4h5v1H0zM1 5h3v1H1zM2 6h1v1H2z'/%3E%3C/svg%3E") center / 100% 100% no-repeat; }
#lobbies [aria-sort="ascending"] > .sort::after, #lobbies [aria-sort="descending"] > .sort::after { opacity: 1;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 7' shape-rendering='crispEdges'%3E%3Cpath d='M2 2h1v1H2zM1 3h3v1H1zM0 4h5v1H0z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 7' shape-rendering='crispEdges'%3E%3Cpath d='M2 2h1v1H2zM1 3h3v1H1zM0 4h5v1H0z'/%3E%3C/svg%3E"); }
#lobbies [aria-sort="descending"] > .sort::after { transform: scaleY(-1); }
#lobbies tbody tr { cursor: pointer; }
#lobbies tbody :is(th, td) { padding-block: calc(var(--vx) * 2); vertical-align: middle; border-block-end: 1px solid color-mix(in oklab, var(--vx-steel) 45%, transparent); }
#lobbies tbody th { font-weight: 600; overflow: hidden; }
#lobbies tbody .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#lobbies tbody .ab { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; font-size: 13px; color: var(--vx-ink-quiet); }
#lobbies tbody td { font-variant-numeric: tabular-nums; white-space: nowrap; }
#lobbies tbody td:last-child { padding-inline-end: calc(var(--vx) * 2); }
#lobbies tbody tr:hover:not([aria-selected="true"]) { background: color-mix(in oklab, var(--vx-slate) 30%, transparent); }
/* The row picked, as the kit's list marks its current row: it stands lighter, and a lamp at its start is lit in signal. */
#lobbies tbody tr > :first-child { position: relative; padding-inline-start: calc(var(--vx) * 4); }
#lobbies tbody tr > :first-child::before { content: ""; position: absolute; left: 0; top: calc(var(--vx) * 2.5); bottom: calc(var(--vx) * 2.5); inline-size: var(--vx); background: color-mix(in oklab, var(--vx-steel) 60%, transparent); }
#lobbies tbody tr[aria-selected="true"] { background: var(--vx-chalk-top, #fff); }
#lobbies tbody tr[aria-selected="true"] > :first-child::before { background: var(--vx-signal); box-shadow: 0 0 6px var(--vx-signal); }
#lobbies tbody tr .full-word { margin-inline-start: 6px; font-weight: 700; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vx-danger-text, #b3261e); }
#lobbies tbody tr:focus { outline: none; }
#lobbies tbody tr:focus-visible > * { box-shadow: inset 0 2px 0 var(--vx-focus), inset 0 -2px 0 var(--vx-focus); }
#lobbies tbody tr:focus-visible > :first-child { box-shadow: inset 2px 2px 0 var(--vx-focus), inset 0 -2px 0 var(--vx-focus); }
#lobbies tbody tr:focus-visible > :last-child { box-shadow: inset -2px 2px 0 var(--vx-focus), inset 0 -2px 0 var(--vx-focus); }

/* A lock in cells, for a server that asks a password. */
#lobbies .lock { display: inline-block; inline-size: 10px; block-size: 12px; margin-inline-end: 6px; vertical-align: -1px; background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 6' shape-rendering='crispEdges'%3E%3Cpath d='M1 0h3v1H1zM1 1h1v1H1zM3 1h1v1H3zM0 2h5v4H0z'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 6' shape-rendering='crispEdges'%3E%3Cpath d='M1 0h3v1H1zM1 1h1v1H1zM3 1h1v1H3zM0 2h5v4H0z'/%3E%3C/svg%3E") center / 100% 100% no-repeat; }
#lobbies tbody td.empty { padding: calc(var(--vx) * 6) 0; text-align: center; color: var(--vx-ink-quiet); white-space: normal; }
#lobbies tbody td.empty::before { display: none; }
#lobbies .ways { display: grid; grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.6fr); gap: calc(var(--vx) * 4) calc(var(--vx) * 8); align-items: start; }
@media (max-width: 560px) { #lobbies .ways { grid-template-columns: 1fr; } }
#lobbies .code-way { display: grid; gap: calc(var(--vx) * 2); }
#lobbies .code-way summary { cursor: pointer; font-weight: 600; font-size: 0.9375rem; min-block-size: 44px; display: flex; align-items: center; gap: 8px; list-style: none; }
#lobbies .code-way summary::-webkit-details-marker { display: none; }
#lobbies .code-way summary::before { content: ""; inline-size: 0; block-size: 0; border-block: 5px solid transparent; border-inline-start: 7px solid currentColor; transition: rotate 0.15s ease-out; }
#lobbies .code-way[open] summary::before { rotate: 90deg; }
#lobbies .code-way summary:focus-visible { outline: 2px solid var(--vx-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { #lobbies .code-way summary::before { transition: none; } }
#lobbies .vx-field { min-inline-size: 0; }
/* Joining: what is being done, step by step, each with its lamp. */
#lobbies .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--vx) * 2); }
#lobbies .steps li { display: flex; align-items: center; gap: 10px; color: var(--vx-ink-quiet); }
#lobbies .steps li::before { content: ""; flex: none; inline-size: 8px; block-size: 8px; margin: 2px; background: color-mix(in oklab, var(--vx-steel), #000 10%); outline: 2px solid color-mix(in oklab, var(--vx-steel), #000 28%); outline-offset: 1px; box-shadow: inset 1px 1px 0 rgb(0 0 0 / 0.25); }
#lobbies .steps li[data-at="done"] { color: var(--vx-ink); }
#lobbies .steps li[data-at="done"]::before { background: var(--vx-leaf); box-shadow: 0 0 6px var(--vx-leaf); }
#lobbies .steps li[data-at="now"] { color: var(--vx-ink); font-weight: 600; }
#lobbies .steps li[data-at="now"]::before { background: var(--vx-signal); box-shadow: 0 0 6px var(--vx-signal); animation: lobbies-breathe 1.2s ease-in-out infinite; }
#lobbies .steps li[data-at="failed"] { color: var(--vx-danger-text, #b3261e); font-weight: 600; }
#lobbies .steps li[data-at="failed"]::before { background: var(--vx-brick, #e0331f); }
@keyframes lobbies-breathe { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { #lobbies .steps li::before { animation: none !important; } }
/* In a lobby. */
#lobbies .whose { padding-inline-start: calc(var(--vx) * 3); border-inline-start: calc(var(--vx) * 1) solid var(--vx-signal); }
#lobbies section[data-failed] .whose { border-inline-start-color: var(--vx-brick, #e0331f); }
#lobbies section[data-failed] .steps { order: 3; }
#lobbies section[data-failed] .join-line { order: 1; }
#lobbies section[data-failed] .join-next { order: 2; }
#lobbies section[data-failed] .whose { order: 0; }
#lobbies .whose b { font-weight: 700; }
#lobbies .about { color: var(--vx-ink-quiet); overflow-wrap: anywhere; }
#lobbies .about:empty { display: none; }
#lobbies .facts { display: flex; flex-wrap: wrap; gap: calc(var(--vx) * 2) calc(var(--vx) * 8); margin: 0; }
#lobbies .facts div { display: grid; }
#lobbies .facts dt { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#lobbies .facts dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
#lobbies .two { display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--vx) * 6); }
@media (max-width: 560px) { #lobbies .two { grid-template-columns: 1fr; } }
#lobbies .two > div { display: grid; gap: calc(var(--vx) * 2); align-content: start; min-inline-size: 0; }
#lobbies ul.people, #lobbies ol.told, #lobbies ul.players, #lobbies ul.bans { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--vx) * 1); }
#lobbies .people li, #lobbies .told li { overflow-wrap: anywhere; }
#lobbies .people .me { color: var(--vx-ink-quiet); font-weight: 400; }
#lobbies .told { max-block-size: 9em; overflow: auto; }
#lobbies .told time { color: var(--vx-ink-quiet); font-variant-numeric: tabular-nums; margin-inline-end: 8px; font-size: 13px; }
#lobbies .told:empty::before, #lobbies .people:empty::before { content: attr(data-empty); color: var(--vx-ink-quiet); }
/* An admin's controls. */
#lobbies .admin { display: grid; grid-template-columns: 1fr 1.15fr; gap: calc(var(--vx) * 6) calc(var(--vx) * 10); align-items: start; }
@media (max-width: 640px) { #lobbies .admin { grid-template-columns: 1fr; } }
#lobbies .admin > .col { display: grid; gap: calc(var(--vx) * 6); min-inline-size: 0; }
#lobbies .admin .col > div { display: grid; gap: calc(var(--vx) * 2); min-inline-size: 0; }
#lobbies .am-row { display: flex; align-items: center; gap: calc(var(--vx) * 4); flex-wrap: wrap; }
#lobbies .am-row .truth { flex: 1 1 14em; }
#lobbies .players li, #lobbies .bans li { display: flex; align-items: center; gap: calc(var(--vx) * 5); min-block-size: calc(var(--vx) * 11); }
#lobbies .players li > span, #lobbies .bans li > span { flex: 1; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#lobbies .players .tag { font-weight: 400; color: var(--vx-ink-quiet); }

#lobbies .admin .vx-toggle-group { inline-size: calc(100% - var(--vx) * 2); grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#lobbies .admin .vx-toggle-group > label { justify-content: center; white-space: nowrap; }
#lobbies .admin .most { display: flex; gap: calc(var(--vx) * 5); align-items: stretch; }
#lobbies .admin .most .vx-well { inline-size: 7em; flex: none; }
#lobbies .admin .rename { display: grid; gap: calc(var(--vx) * 2); }
#lobbies .done { font-size: 14px; font-weight: 600; min-block-size: 1.4em; }
#lobbies .done[data-tone="bad"] { color: var(--vx-danger-text, #b3261e); }
#lobbies .done:empty { display: none; }
/* Hosting. */
#lobbies pre { margin: 0; padding: calc(var(--vx) * 3) calc(var(--vx) * 4); overflow-x: auto; font: 400 13px/1.55 var(--vx-mono); background: color-mix(in oklab, var(--vx-chalk), #0a0f3d 7%); box-shadow: inset 0 0 0 calc(var(--vx) * 0.5) var(--vx-slate); white-space: pre; }
#lobbies .flags { margin: 0; padding-inline-start: 1.2em; display: grid; gap: 4px; color: var(--vx-ink-quiet); font-size: 14px; }
#lobbies .flags code { font: 500 13px var(--vx-mono); color: var(--vx-ink); white-space: nowrap; }
#lobbies pre { scrollbar-width: thin; scrollbar-color: var(--vx-steel) transparent; }
.lobbies-hide { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* In a lobby: whose server this is, always, in the top left corner; pressed, the server's panel. */
#lobby-tag { position: fixed; z-index: 5; left: max(24px, env(safe-area-inset-left)); top: max(24px, env(safe-area-inset-top)); max-inline-size: min(420px, calc(100vw - 140px)); min-block-size: 44px; padding-inline: calc(var(--vx) * 5) calc(var(--vx) * 4); }
#lobby-tag .lamp { flex: none; inline-size: 8px; block-size: 8px; background: var(--vx-leaf, #23a84b); box-shadow: 0 0 6px var(--vx-leaf, #23a84b); }
#lobby-tag .lamp.off { background: var(--vx-brick, #e0331f); box-shadow: none; }
#lobby-tag .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-inline-size: 0; }
#lobby-tag .q { flex: none; opacity: 0.72; }
@media (pointer: coarse) { #lobby-tag > span { max-inline-size: calc(100vw - 210px); } }
/* (Held upright the name has the room: how many are here is in the room's panel.) */
@media (max-width: 480px) { #lobby-tag .n { display: none; } #lobbies[data-view="here"] > footer .k-close { order: -1; flex-basis: 100%; } }
/* By touch, under the credits key, in its column (beside it there is room for a name of a few letters), clear of the keys on the right. */
@media (pointer: coarse) { #lobby-tag { top: calc(env(safe-area-inset-top, 0px) + 74px); left: max(22px, calc(env(safe-area-inset-left) + 16px)); max-inline-size: calc(100vw - 170px); --vx: 3px; padding-inline-start: calc(var(--vx) * 7); --vx-key-size: var(--vx-key-small); padding-inline: calc(var(--vx) * 5) calc(var(--vx) * 4); } }

/* On a desk clear of the corner keys above it (the Servers key, the lobby's tag). */
@media (pointer: fine) { #lobbies { max-block-size: min(calc(100dvh - 136px), calc(var(--seen, 100dvh) - 136px)); } }
/* An admin's password: the field its column's width, its two keys under it. */
#lobbies .admin .key { flex-wrap: wrap; row-gap: calc(var(--vx) * 4); }
#lobbies .admin .key:has(.lock-go) .vx-well { flex: 1 1 100%; }
#lobbies .admin .key:has(.lock-go) .lock-go { margin-inline-start: calc(var(--vx) * 3); }
#lobbies .admin .rename > div { margin-block-start: calc(var(--vx) * 2); }
/* Failed, the header says so: the line under it is not said twice. */
#lobbies section[data-failed] .whose { display: none; }
/* (Last, over the rules above: by a phone held upright a field takes the row and its keys share the one under it.) */
@media (max-width: 480px) {
  #lobbies .key { flex-wrap: wrap; row-gap: calc(var(--vx) * 4); }
  #lobbies .key .vx-well { flex: 1 1 100%; }
  #lobbies .key .vx-button { flex: 1 1 0; justify-content: center; }
}
`

const SEP = ' · '

let panel: ReturnType<typeof build> | null = null
/** What a door joined as the page started said before its room was up (main.ts builds the world in between): told it then. */
const early: { gone: string | null; told: string[] } = { gone: null, told: [] }
let seam: Seam | null = null

/** The panel, once: the dialog with each of its views, laid out for whichever is shown. */
function build() {
  if (!document.querySelector('link[href$="voxelmorphism.css"]')) {
    const sheet = document.createElement('link')
    sheet.rel = 'stylesheet'; sheet.href = new URL('../kit/voxelmorphism.css', import.meta.url).href
    document.head.append(sheet)
    legends()
    document.documentElement.dataset.vxLook = 'lit'
  }
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const d = document.createElement('dialog')
  d.id = 'lobbies'; d.className = 'vx-dialog'
  d.setAttribute('aria-labelledby', 'lobbies-h')
  d.innerHTML = /* html */ `
    <header><span id="lobbies-h">Servers</span><span class="sub" aria-hidden="true"></span></header>
    <div class="vx-dialog-body">
      <section data-view="list">
        <p class="truth">Servers run on players’ own machines. <b>A host sees your address and what you do there.</b></p>
        <div class="bar"><p class="count" role="status"></p><button class="vx-button refresh" type="button" title="Ask the master for the list again"><span>Refresh</span></button></div>
        <div class="vx-table"><div class="vx-table-scroll">
          <table role="grid" aria-readonly="true" aria-labelledby="lobbies-cap">
            <caption id="lobbies-cap" class="lobbies-hide">Servers on this version of the city. Arrow keys move, Enter joins.</caption>
            <thead><tr>
              <th scope="col" data-key="name"><button type="button" class="sort">Name</button></th>
              <th scope="col" class="vx-num n" data-key="players"><button type="button" class="sort" aria-label="Players">Players</button></th>
              <th scope="col" class="l" data-key="locked"><button type="button" class="sort" aria-label="Password"><span class="h-long">Password</span><span class="lock h-short" aria-hidden="true"></span></button></th>
              <th scope="col" class="vx-num u" data-key="since"><button type="button" class="sort" aria-label="Up for"><span class="h-long">Up for</span><span class="h-short">Up</span></button></th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div></div>
        <p class="line list-line" role="status"></p>
        <div class="ways">
          <div class="vx-field"><label class="vx-field-label" for="lobbies-name">Your name</label><span class="vx-well"><input id="lobbies-name" maxlength="24" autocomplete="nickname" spellcheck="false" autocapitalize="off" placeholder="guest" enterkeyhint="done"></span></div>
          <details class="code-way"><summary>Have a private server’s code?</summary><div class="vx-field"><label class="vx-field-label" for="lobbies-code">Its code, as its host gave it to you</label><div class="key"><span class="vx-well"><input id="lobbies-code" maxlength="20" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="go" data-1p-ignore data-lpignore="true" data-bwignore></span><button class="vx-button by-code" type="button"><span>Join by code</span></button></div></div></details>
        </div>
      </section>
      <section data-view="joining">
        <p class="whose"><span class="going">Joining</span> <b class="to"></b></p>
        <ol class="steps" aria-label="Joining">
          <li data-step="finding">Finding the server</li>
          <li data-step="calling">Calling its host</li>
          <li data-step="opening">Opening a line to them</li>
          <li data-step="hello">Saying hello, and who you are</li>
        </ol>
        <div class="vx-field pw" hidden>
          <label class="vx-field-label" for="lobbies-pw">This server asks for a password</label>
          <div class="key"><span class="vx-well"><input id="lobbies-pw" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="go" data-1p-ignore data-lpignore="true" data-bwignore aria-describedby="lobbies-pw-note"></span></div>
          <p class="truth" id="lobbies-pw-note">It goes to the server alone. This page keeps nothing of it.</p>
        </div>
        <p class="line join-line" role="status"></p>
        <p class="next join-next"></p>
      </section>
      <section data-view="here">
        <p class="whose">You are in <b class="srv"></b>, a server someone runs on their own machine. Its host sees what you do here.</p>
        <p class="about"></p>
        <dl class="facts"><div><dt>Players</dt><dd class="f-players"></dd></div><div><dt>Who may build</dt><dd class="f-build"></dd></div></dl>
        <div class="two">
          <div><h3 id="lobbies-who">Who is here</h3><ul class="people" aria-labelledby="lobbies-who" data-empty="Asking…"></ul></div>
          <div><h3 id="lobbies-said">What the server says</h3><ol class="told" aria-labelledby="lobbies-said" aria-live="polite" data-empty="Nothing yet."></ol></div>
        </div>
        <div class="am-row" hidden><p class="truth">Run this server, or were given its admin password?</p><button class="vx-button k-admin" type="button"><span>I am an admin…</span></button></div>
        <div class="vx-field am" hidden>
          <label class="vx-field-label" for="lobbies-admin">The admin password</label>
          <div class="key"><span class="vx-well"><input id="lobbies-admin" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="go" data-1p-ignore data-lpignore="true" data-bwignore></span><button class="vx-button am-go" type="button"><span>Become admin</span></button></div>
          <p class="done am-done" role="status"></p>
        </div>
      </section>
      <section data-view="admin"></section>
      <section data-view="host">
        <p>A server runs on your own machine, and other players connect to you. This site runs no servers: it only lists them, and nobody plays on its machines.</p>
        <p class="truth"><b>Early:</b> there is no download yet. A server is started from a copy of the Village code, with Node and Rust installed.</p>
        <p class="truth">Others reach your machine straight over WebRTC, so your network must let them in, and <b>whoever joins sees your address</b>.</p>
        <pre class="cmd" tabindex="0" aria-label="The command that starts a server"></pre>
        <ul class="flags">
          <li><code>--private</code> keeps it off this list: friends join with the code it prints.</li>
          <li><code>--password-file</code> asks a password. <code>--admin-password-file</code> makes you its admin here.</li>
        </ul>
        <p class="line host-line" role="status"></p>
      </section>
      <section data-view="out">
        <p class="line out-line" data-tone="bad" role="alert"></p>
        <p class="next">You are not in that server any more. What you see now stands still until you go back to your own world.</p>
      </section>
    </div>
    <footer>
      <button class="vx-button k-host gap" type="button"><span>Host a server…</span></button>
      <button class="vx-button k-leave gap" type="button" data-vx-kind="danger"><span>Leave server</span></button>
      <button class="vx-button k-list" type="button"><span>Server list</span></button>
      <button class="vx-button k-back" type="button"><span>Back</span></button>
      <button class="vx-button k-copy" type="button" data-vx-kind="main"><span>Copy command</span></button>
      <button class="vx-button k-cancel" type="button"><span>Cancel</span></button>
      <button class="vx-button k-alone" type="button"><span>Your own world</span></button>
      <button class="vx-button k-close" type="button"><span>Close</span></button>
      <button class="vx-button k-home" type="button" data-vx-kind="main"><span>Your own world</span></button>
      <button class="vx-button k-again" type="button" data-vx-kind="main"><span>Server list</span></button>
      <button class="vx-button k-join" type="button" data-vx-kind="main"><span>Join</span></button>
    </footer>`
  document.body.append(d)
  const $ = <T extends Element>(s: string) => d.querySelector<T>(s)!
  let kit: Kit | null = null, drawn = ''
  if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(new URL('../kit/src/index.js', import.meta.url).href).then((k: Kit) => { kit = k; redraw() }).catch(() => {})
  /** Parts that were hidden when the kit drew them are drawn as they are now. */
  const redraw = () => {
    if (!kit) return
    const shown = [...d.querySelectorAll<HTMLElement>('.vx-well, .vx-button, .vx-toggle-group, .vx-table')].filter((el) => !el.closest('[hidden]')).map((el) => `${el.className}:${el.offsetWidth}x${el.offsetHeight}`).join()
    if (shown === drawn) return
    drawn = shown
    requestAnimationFrame(() => { kit?.adopt(d); for (const el of d.querySelectorAll('.vx-well, .vx-button, .vx-toggle-group, .vx-table')) kit?.refresh?.(el) })
  }
  // Whether there is more of the body below what is seen (its edge of shade).
  const body = d.querySelector<HTMLElement>('.vx-dialog-body')!
  const more = () => { body.toggleAttribute('data-more', body.scrollHeight - body.scrollTop - body.clientHeight > 4); body.toggleAttribute('data-less', body.scrollTop > 4) }
  body.addEventListener('scroll', more, { passive: true })
  new ResizeObserver(more).observe(body)
  for (const el of body.children) new ResizeObserver(more).observe(el)
  // Opened by a pointer, it gives the focus back to no ring: the browser's return of focus to the key that opened it is not a keyboard's.
  let byPointer = false
  addEventListener('pointerdown', () => { byPointer = true }, true)
  addEventListener('keydown', () => { byPointer = false }, true)
  d.addEventListener('close', () => { if (byPointer) setTimeout(() => { const a = document.activeElement; if (a instanceof HTMLElement && a !== document.body && !d.contains(a)) a.blur() }) })
  const fit = () => d.style.setProperty('--seen', `${Math.round(visualViewport?.height ?? innerHeight)}px`)
  visualViewport?.addEventListener('resize', fit); fit()
  const KEYS: Record<View, string[]> = {
    list: ['k-host', 'k-close', 'k-join'],
    joining: ['k-cancel', 'k-join'],
    here: ['k-leave', 'k-list', 'k-close'],
    admin: ['k-back', 'k-close'],
    host: ['k-back', 'k-copy'],
    out: ['k-list', 'k-home'],
  }
  let view: View = 'list', leave: (() => void) | null = null
  const show = (v: View, keys = KEYS[v]) => {
    view = v
    d.dataset.view = v
    for (const s of d.querySelectorAll<HTMLElement>('section[data-view]')) s.hidden = s.dataset.view !== v
    for (const b of d.querySelectorAll<HTMLElement>('footer > button')) b.hidden = !keys.some((k) => b.classList.contains(k))
    body.scrollTop = 0
    redraw()
    requestAnimationFrame(more)
  }
  const open = (input: Input | null) => {
    if (d.open) return
    leave = input?.push({ name: 'lobbies', solid: true, text: true }) ?? null
    d.showModal()
  }
  d.addEventListener('close', () => { leave?.(); leave = null; onclose?.() })
  let onclose: (() => void) | null = null
  return { d, $, show, open, redraw, get view() { return view }, set onclose(f: (() => void) | null) { onclose = f }, get kit() { return kit } }
}

/** A key's words, changed in its own span (the kit draws the key in a canvas beside it). */
const legend = (key: HTMLElement, words: string) => { const span = key.querySelector('span'); if (span && span.textContent !== words) { span.textContent = words; panel?.kit?.refresh?.(key) } }
const line = (el: HTMLElement, text: string, bad: boolean | 'quiet' = false) => { el.textContent = text; if (bad) el.dataset.tone = bad === 'quiet' ? 'quiet' : 'bad'; else delete el.dataset.tone; if (bad === true && text) el.scrollIntoView({ block: 'nearest' }) }
const touch = () => matchMedia('(pointer: coarse)').matches

// ── The list ──────────────────────────────────────────────────────────────

/** The master's list of lobbies on this page's release: every page of it to ROWS_MOST rows. */
async function listed(master: string, pin: string, signal: AbortSignal): Promise<{ rows: Row[]; cut: boolean } | { why: Why; wait: number }> {
  const base = masterOf(master)
  if (!base) return { why: 'master', wait: 0 }
  const rows: Row[] = [], ids = new Set<string>(), cursors = new Set<string>()
  let after: string | null = null, pages = 0
  do {
    // At most as many pages as the rows they could hold at the master's own page size (guide/master.md: 200), and
    // never a cursor twice: a master that says there is more for ever is asked no further.
    if (++pages > Math.ceil(ROWS_MOST / 200) + 1 || (after && cursors.has(after))) return { rows, cut: true }
    if (after) cursors.add(after)
    const u = new URL(`${base}/lobbies`)
    u.searchParams.set('pin', pin)
    if (after) u.searchParams.set('after', after)
    let r: Response
    try { r = await fetch(u, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) }) } catch { return { why: 'master', wait: 0 } }
    if (r.status === 429 || r.status === 403) return { why: 'slow', wait: Math.min(600, Number(r.headers.get('Retry-After')) || 60) }
    if (!r.ok) return { why: 'master', wait: 0 }
    let v: Record<string, unknown>
    try { v = await asked(r) } catch { return { why: 'master', wait: 0 } }
    if (!Array.isArray(v.lobbies)) return { why: 'master', wait: 0 }
    for (const l of v.lobbies as Record<string, unknown>[]) {
      if (!l || typeof l !== 'object' || typeof l.id !== 'string' || !/^[0-9A-Za-z]{1,32}$/.test(l.id) || ids.has(l.id) || (typeof l.pin === 'string' && l.pin !== pin)) continue
      ids.add(l.id)
      rows.push({ id: l.id, name: plain(l.name, 48) || 'A Village server', about: plain(l.about, 120), players: Math.max(0, Math.floor(Number(l.players)) || 0), most: Math.max(0, Math.floor(Number(l.most)) || 0), locked: l.locked === true, since: Number(l.since) || Date.now() / 1000 })
      if (rows.length >= ROWS_MOST) return { rows, cut: true }
    }
    after = typeof v.next === 'string' && v.next ? v.next.slice(0, 64) : null
  } while (after)
  return { rows, cut: false }
}

function list(p: NonNullable<typeof panel>, s: Seam) {
  const { $ } = p
  const body = $<HTMLTableSectionElement>('tbody'), count = $<HTMLElement>('.count'), said_ = $<HTMLElement>('.list-line')
  const nameIn = $<HTMLInputElement>('#lobbies-name'), codeIn = $<HTMLInputElement>('#lobbies-code')
  const refresh = $<HTMLButtonElement>('.refresh'), join = $<HTMLButtonElement>('.k-join')
  let rows: Row[] = [], cut = false, picked: string | null = null, sort: { key: Key; down: boolean } = { key: 'players', down: true }
  let asking: AbortController | null = null, heard = 0, waitUntil = 0, failing: string | null = null, timer: ReturnType<typeof setInterval> | undefined
  const pinned = where().then((w) => w.release ?? 'town')
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const order = (a: Row, b: Row) => {
    const by = sort.key === 'name' ? collator.compare(a.name, b.name) : sort.key === 'players' ? a.players - b.players || a.most - b.most : sort.key === 'locked' ? Number(a.locked) - Number(b.locked) : b.since - a.since
    return (sort.down ? -by : by) || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1)
  }
  const draw = () => {
    for (const th of p.d.querySelectorAll<HTMLElement>('thead th')) { if (th.dataset.key === sort.key) th.setAttribute('aria-sort', sort.down ? 'descending' : 'ascending'); else th.removeAttribute('aria-sort') }
    const sorted = [...rows].sort(order)
    if (picked && !sorted.some((r) => r.id === picked)) picked = null
    const made = sorted.map((r, i) => {
      const tr = document.createElement('tr')
      tr.dataset.id = r.id
      tr.setAttribute('aria-selected', String(r.id === picked))
      tr.tabIndex = r.id === picked || (!picked && i === 0) ? 0 : -1
      if (r.most && r.players >= r.most) tr.classList.add('full')
      const th = document.createElement('th'), nm = document.createElement('span'), ab = document.createElement('span')
      th.scope = 'row'; nm.className = 'nm'; ab.className = 'ab'
      nm.textContent = r.name; ab.textContent = r.about
      th.append(nm); if (r.about) th.append(ab)
      th.title = r.about ? `${r.name}\n${r.about}` : r.name
      const players = document.createElement('td'), lock = document.createElement('td'), up = document.createElement('td')
      players.className = 'vx-num p'; players.textContent = `${r.players} / ${r.most}`
      if (r.most && r.players >= r.most) { const f = document.createElement('span'); f.className = 'full-word'; f.textContent = 'Full'; players.append(f) }
      players.setAttribute('aria-label', `${r.players} of ${r.most} players${r.most && r.players >= r.most ? ', full' : ''}`)
      lock.className = 'l'
      if (r.locked) { const i = document.createElement('span'); i.className = 'lock'; i.setAttribute('aria-hidden', 'true'); const w = document.createElement('span'); w.className = 'lock-word'; w.textContent = 'Yes'; lock.append(i, w); lock.setAttribute('aria-label', 'asks a password') }
      else lock.setAttribute('aria-label', 'open')
      up.className = 'vx-num u'
      const long = document.createElement('span'), short = document.createElement('span')
      long.className = 'up-long'; long.textContent = upFor(r.since); short.className = 'up-short'; short.textContent = upFor(r.since, true)
      up.append(long, short); up.setAttribute('aria-label', `up for ${upFor(r.since)}`)
      tr.append(th, players, lock, up)
      return tr
    })
    if (!made.length) {
      const tr = document.createElement('tr'), td = document.createElement('td')
      td.colSpan = 4; td.className = 'empty'
      td.textContent = failing ? 'The list could not be had just now.' : heard ? 'No servers on this version of the city right now. Host one, or join a private one by its code.' : 'Asking the master for servers…'
      tr.append(td); made.push(tr)
    }
    const focused = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : null
    body.replaceChildren(...made)
    if (focused) body.querySelector<HTMLElement>(`tr[data-id="${focused}"]`)?.focus({ preventScroll: true })
    const n = rows.length
    const stale = said_.dataset.tone === 'bad' && !!heard
    count.textContent = failing || !heard ? '' : `${n === 1 ? '1 server' : `${n.toLocaleString('en-US')} servers`}${cut ? ' (not all: the list is longer)' : ''}${SEP}${stale ? `could not refresh: the list as of ${Date.now() - heard < 60_000 ? 'a moment' : upFor(heard / 1000)} ago` : Date.now() - heard < 5000 ? 'just now' : `asked ${upFor(heard / 1000)} ago`}`
    picking()
  }
  const ask = async (byHand: boolean) => {
    if (Date.now() < waitUntil) { if (byHand) line(said_, said('slow', { wait: Math.ceil((waitUntil - Date.now()) / 1000) })[0], true); return }
    asking?.abort()
    const a = (asking = new AbortController())
    refresh.setAttribute('aria-busy', 'true')
    if (byHand) line(said_, 'Asking the master…')
    const got = await listed(s.master, await pinned, a.signal)
    if (a.signal.aborted) return
    asking = null
    refresh.removeAttribute('aria-busy')
    if ('why' in got) {
      if (got.why === 'slow') waitUntil = Date.now() + got.wait * 1000
      const [what, next] = said(got.why, { wait: got.wait })
      failing = what
      line(said_, `${what} ${got.why === 'master' ? 'You can keep playing in your own world.' : next}`, true)
      if (rows.length) failing = null
    } else {
      failing = null
      rows = got.rows; cut = got.cut; heard = Date.now()
      if (byHand || said_.dataset.tone === 'bad') line(said_, '')
    }
    draw()
  }
  /** Join is for a row that is picked and not full; the line says why not. */
  const picking = () => {
    const r = rows.find((x) => x.id === picked), full = !!r && !!r.most && r.players >= r.most
    join.disabled = !r || full || joining
    // How to join, while nothing is picked: in the count's line, where it costs no room.
    count.title = ''
    const how = !r && rows.length && !failing && said_.dataset.tone !== 'bad' ? (touch() ? 'tap one, then Join' : 'pick one, then Join (or double-click it)') : ''
    count.querySelector('.how')?.remove()
    if (how) { const h = document.createElement('span'); h.className = 'how'; h.textContent = `${SEP}${how}`; count.append(h) }
    if (said_.dataset.tone === 'bad' || /^(Checking|Joining)/.test(said_.textContent ?? '')) return
    line(said_, full ? `${r!.name} is full. Pick another, or refresh until someone leaves.` : '', 'quiet')
  }
  const pick = (id: string | null, focus = true) => {
    picked = id
    for (const tr of body.querySelectorAll<HTMLElement>('tr[data-id]')) { const on = tr.dataset.id === id; tr.setAttribute('aria-selected', String(on)); tr.tabIndex = on ? 0 : -1; if (on && focus) tr.focus() }
    picking()
  }
  body.addEventListener('click', (e) => { const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]'); if (tr) pick(tr.dataset.id!) })
  body.addEventListener('dblclick', (e) => { const tr = (e.target as Element).closest<HTMLElement>('tr[data-id]'); if (tr) { pick(tr.dataset.id!); void go() } })
  body.addEventListener('keydown', (e) => {
    const trs = [...body.querySelectorAll<HTMLElement>('tr[data-id]')], at = trs.findIndex((t) => t === document.activeElement)
    if (at < 0) return
    const to = e.key === 'ArrowDown' ? Math.min(trs.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? trs.length - 1 : e.key === 'PageDown' ? Math.min(trs.length - 1, at + 8) : e.key === 'PageUp' ? Math.max(0, at - 8) : -1
    if (to >= 0) { e.preventDefault(); pick(trs[to].dataset.id!); trs[to].scrollIntoView({ block: 'nearest' }); return }
    if (e.key === ' ') { e.preventDefault(); pick(trs[at].dataset.id!) }
    if (e.key === 'Enter') { e.preventDefault(); pick(trs[at].dataset.id!); void go() }
  })
  for (const th of p.d.querySelectorAll<HTMLElement>('thead th')) th.querySelector('button')!.addEventListener('click', () => {
    const key = th.dataset.key as Key
    sort = sort.key === key ? { key, down: !sort.down } : { key, down: key === 'players' || key === 'locked' }
    draw()
  })
  refresh.addEventListener('click', () => void ask(true))
  nameIn.value = named()
  nameIn.addEventListener('change', () => { nameIn.value = plain(nameIn.value, 24); keepName(nameIn.value) })
  codeIn.addEventListener('input', () => { codeIn.removeAttribute('aria-invalid') })
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void byCode() } })
  $<HTMLButtonElement>('.by-code').addEventListener('click', () => void byCode())
  // Opened, the code's field is brought into view and takes the keys.
  $<HTMLDetailsElement>('.code-way').addEventListener('toggle', (e) => { const d = e.currentTarget as HTMLDetailsElement; if (d.open) { p.redraw(); requestAnimationFrame(() => { d.scrollIntoView({ block: 'nearest' }); codeIn.focus({ preventScroll: true }) }) } })

  /** Joins: asks the master for the lobby (gone, another release, full), then loads the page again with it in the ticket. */
  /** One join at a time: a second asked while the first is checked would race it for the ticket. */
  let joining = false
  const joinTo = async (lobby: string, label: string | null, by: 'row' | 'code') => {
    if (joining) return
    joining = true
    join.disabled = true
    let leaving = false
    try { leaving = await joinOnce(lobby, label, by) === true } finally { if (!leaving) { joining = false; picking() } }
  }
  const joinOnce = async (lobby: string, label: string | null, by: 'row' | 'code') => {
    const name = plain(nameIn.value, 24); keepName(name)
    const base = masterOf(s.master)
    if (!base) return void line(said_, `${said('master')[0]} ${said('master')[1]}`, true)
    line(said_, `Checking ${label ?? 'that code'}…`)
    let r: Response | null = null, v: Record<string, unknown> = {}
    try { r = await fetch(`${base}/lobbies/${encodeURIComponent(lobby)}`, { credentials: 'omit', signal: AbortSignal.timeout(10_000) }); v = await asked(r) } catch { /* said below */ }
    const pin = await pinned
    if (!r) return void line(said_, `${said('master')[0]} ${said('master')[1]}`, true)
    if (r.status === 429 || r.status === 403) return void line(said_, said('slow', { wait: Number(r.headers.get('Retry-After')) || 60 }).join(' '), true)
    if (r.status === 404) {
      if (by === 'code') { codeIn.setAttribute('aria-invalid', 'true'); return void line(said_, 'No server has that code. Check it with whoever gave it to you: codes are 20 letters and digits.', true) }
      void ask(false)
      return void line(said_, said('gone').join(' '), true)
    }
    if (!r.ok || typeof v.pin !== 'string') return void line(said_, `${said('master')[0]} ${said('master')[1]}`, true)
    if (v.pin !== pin) return void line(said_, said('pin', { pin: v.pin }).join(' '), true)
    const players = Number(v.players) || 0, most = Number(v.most) || 0
    if (most && players >= most) return void line(said_, said('full').join(' '), true)
    const shown = plain(v.name, 48) || label || 'that server'
    try { sessionStorage.setItem(TICKET, JSON.stringify({ master: s.master, lobby, name: name || null, label: shown, at: Date.now() })) } catch {
      return void line(said_, 'This window keeps nothing, so it cannot carry the server into the page as it loads again. Open the page in an ordinary window.', true)
    }
    line(said_, `Joining ${shown}: the page loads again to step in…`)
    joining = true
    // In a lobby already, or there by address: the address is the page's own world again.
    const u = new URL(location.href)
    u.searchParams.delete('lobby'); u.searchParams.delete('name')
    if (u.href === location.href) location.reload(); else location.replace(u)
    return true
  }
  const go = async () => {
    const r = rows.find((x) => x.id === picked)
    if (!r) return void line(said_, 'Pick a server in the list first.', true)
    if (r.most && r.players >= r.most) return void line(said_, said('full').join(' '), true)
    await joinTo(r.id, r.name, 'row')
  }
  const byCode = async () => {
    const code = codeIn.value.trim()
    if (!/^[0-9A-Za-z]{20}$/.test(code)) { codeIn.setAttribute('aria-invalid', 'true'); line(said_, 'A private server’s code is 20 letters and digits, as its host printed it.', true); codeIn.focus(); return }
    await joinTo(code.toLowerCase(), null, 'code')
  }
  return {
    go,
    /** Shown: asked at once, and quietly again while it is open and seen. */
    shown() {
      line(said_, '')
      nameIn.value = named()
      draw()
      void ask(false)
      clearInterval(timer)
      timer = setInterval(() => { if (p.d.open && p.view === 'list' && document.visibilityState === 'visible' && !asking) void ask(false) }, QUIET)
    },
    hidden() { clearInterval(timer); asking?.abort(); asking = null; refresh.removeAttribute('aria-busy') },
    focus() { (body.querySelector<HTMLElement>('tr[tabindex="0"]') ?? refresh).focus() },
  }
}

// ── Joining, as the page starts ───────────────────────────────────────────

/**
 * Joins the lobby the ticket names, as the page starts (main.ts, before the world is built): says what is being done,
 * asks the password where the server asks one, and says plainly why not where it did not. Resolves with the door, or
 * null, the panel then left open with what to do next while the page goes on alone.
 */
export async function arrive(o: { master: string; lobby: string; name: string | null; label: string; hud: Hud; input: Input }): Promise<Door | null> {
  panel ??= build()
  const p = panel, { $ } = p
  seam = { master: o.master, hud: o.hud, input: o.input, door: null }
  $<HTMLElement>('#lobbies-h').textContent = 'Joining a server'
  $<HTMLElement>('.to').textContent = plain(o.label, 48) || 'a server'
  $<HTMLElement>('.going').textContent = 'Joining'
  const steps = [...p.d.querySelectorAll<HTMLElement>('.steps li')]
  const pw = $<HTMLElement>('.pw'), pwIn = $<HTMLInputElement>('#lobbies-pw'), pwLabel = $<HTMLElement>('label[for=lobbies-pw]')
  const joinLine = $<HTMLElement>('.join-line'), joinNext = $<HTMLElement>('.join-next')
  const join = $<HTMLButtonElement>('.k-join'), cancel = $<HTMLButtonElement>('.k-cancel')
  let at: Stage = 'finding'
  const stage = (now: Stage) => { at = now; const i = steps.findIndex((s) => s.dataset.step === now); steps.forEach((s, k) => { s.dataset.at = k < i ? 'done' : k === i ? 'now' : '' }) }
  stage('finding')
  steps.find((x) => x.dataset.step === 'hello')!.textContent = 'Saying hello, and who you are'
  delete $<HTMLElement>('section[data-view="joining"]').dataset.failed
  line(joinLine, ''); joinNext.textContent = ''
  pw.hidden = true
  p.show('joining', ['k-cancel'])
  p.open(o.input)
  let given: ((v: string | null) => void) | null = null
  const giving = (v: string | null) => { const g = given; given = null; pwIn.value = ''; g?.(v) }
  let cancelled = false, stop: (v: null) => void = () => {}
  const stopped = new Promise<null>((done) => { stop = done })
  const cancelJoin = () => { cancelled = true; giving(null); stop(null) }
  cancel.onclick = () => { cancelJoin(); p.d.close() }
  p.onclose = () => { if (!cancelled) cancelJoin() }
  join.onclick = () => { if (given) { if (!pwIn.value) { line(joinLine, 'Type the password first.', true); pwIn.focus(); return } giving(pwIn.value) } }
  pwIn.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); join.click() } }
  try {
    const joining = enter({
      master: o.master, lobby: o.lobby, name: o.name, stage,
      password: ({ why, wait }) => new Promise<string | null>((done) => {
        if (cancelled) return done(null)
        given = done
        pw.hidden = false
        pwLabel.textContent = `${plain(o.label, 48) || 'This server'} asks for a password`
        legend(join, 'Join')
        p.show('joining', ['k-cancel', 'k-join'])
        if (why === 'password') line(joinLine, '')
        else line(joinLine, said(why, { wait })[0], true)
        joinNext.textContent = why === 'tries' ? said(why, { wait })[1] : ''
        stage('hello')
        steps.find((x) => x.dataset.step === 'hello')!.textContent = 'Waiting for your password'
        join.disabled = why === 'tries' && wait > 0
        if (join.disabled) setTimeout(() => { join.disabled = false }, wait * 1000)
        setTimeout(() => pwIn.focus())
      }).then((v) => { pw.hidden = true; p.show('joining', ['k-cancel']); if (v) line(joinLine, 'Trying the password…'); steps.find((x) => x.dataset.step === 'hello')!.textContent = 'Saying hello, and who you are'; stage('finding'); return v }),
    })
    // Cancelled while it is under way: the page goes on now, and a door that opens after all is shut at once.
    const door = await Promise.race([joining, stopped])
    if (!door || cancelled) { void joining.then((d) => d.lost('you left'), () => {}); return null }
    p.onclose = null
    cancel.onclick = null; join.onclick = null
    p.d.close()
    // (Kept, not said: the room says it in its own words once it is up, and the door's own banner would stay over it.)
    door.ongone = (why) => { early.gone = why }
    door.ontold = (text) => { if (early.told.length < 50) early.told.push(text) }
    return door
  } catch (e) {
    p.onclose = null
    cancel.onclick = null; join.onclick = null
    if (cancelled) { notice(null); return null }
    const r = e instanceof Refused ? e : new Refused(e instanceof Error ? e.message : String(e), 'other')
    const [what, next] = said(r.why, { message: r.message, wait: r.wait })
    for (const s of steps) if (s.dataset.step === at) s.dataset.at = 'failed'
    $<HTMLElement>('.going').textContent = 'Could not join'
    $<HTMLElement>('#lobbies-h').textContent = `Could not join ${plain(o.label, 48) || 'that server'}`
    $<HTMLElement>('section[data-view="joining"]').dataset.failed = ''
    line(joinLine, what, true)
    joinNext.textContent = `${next} Meanwhile you are in your own world.`
    p.show('joining', ['k-alone', 'k-again'])
    $<HTMLButtonElement>('.k-alone').onclick = () => p.d.close()
    $<HTMLButtonElement>('.k-again').onclick = () => openList()
    setTimeout(() => $<HTMLButtonElement>('.k-again').focus())
    return null
  }
}

// ── The panel's ways in ───────────────────────────────────────────────────

let listing: ReturnType<typeof list> | null = null
let here: ReturnType<typeof inLobby> | null = null

function openList() {
  if (!seam) return
  panel ??= build()
  const p = panel
  listing ??= list(p, seam)
  p.$<HTMLElement>('#lobbies-h').textContent = 'Servers'
  p.$<HTMLElement>('.sub').textContent = ''
  p.show('list')
  wire(p)
  p.open(seam.input)
  listing.shown()
  setTimeout(() => listing?.focus())
}
function openHost() {
  const p = panel!
  p.$<HTMLElement>('#lobbies-h').textContent = 'Host a server'
  // The host command (guide/multiplayer.md), with the master this page finds servers through.
  p.$<HTMLElement>('.cmd').textContent = [
    'cd engine',
    'npm ci && npm run core',
    'node sf/build.mjs',
    'node server.mjs \\',
    '  --world ~/my-world.log \\',
    '  --release dist-sf \\',
    `  --master ${quoted(masterOf(seam?.master ?? '') ?? 'https://<a master>')} \\`,
    '  --name "My server" --most 8',
  ].join('\n')
  listing?.hidden()
  p.show('host')
  line(p.$<HTMLElement>('.host-line'), '')
  setTimeout(() => p.$<HTMLButtonElement>('.k-copy').focus())
}

/** The footer's keys, wired once: each does what the view shown asks of it. */
let wired = false
function wire(p: NonNullable<typeof panel>) {
  if (wired) return
  wired = true
  const { $ } = p
  $<HTMLButtonElement>('.k-close').addEventListener('click', () => p.d.close())
  $<HTMLButtonElement>('.k-join').addEventListener('click', () => { if (p.view === 'list') void listing?.go() })
  $<HTMLButtonElement>('.k-host').addEventListener('click', openHost)
  $<HTMLButtonElement>('.k-back').addEventListener('click', () => { if (seam?.door && p.view === 'admin') here?.show(); else if (seam?.door && p.view === 'host') here?.show(); else openList() })
  $<HTMLButtonElement>('.k-list').addEventListener('click', () => { if (p.view !== 'joining') openList() })
  $<HTMLButtonElement>('.k-copy').addEventListener('click', async () => {
    const text = $<HTMLElement>('.cmd').textContent ?? ''
    try { await navigator.clipboard.writeText(text); line($<HTMLElement>('.host-line'), 'Copied.') } catch {
      const r = document.createRange(); r.selectNodeContents($<HTMLElement>('.cmd')); getSelection()?.removeAllRanges(); getSelection()?.addRange(r)
      line($<HTMLElement>('.host-line'), 'This browser would not copy it: it is selected, to copy by hand.')
    }
  })
  $<HTMLButtonElement>('.k-leave').addEventListener('click', home)
  $<HTMLButtonElement>('.k-home').addEventListener('click', home)
  $<HTMLButtonElement>('.k-admin').addEventListener('click', () => here?.asAdmin())
  p.onclose = () => { listing?.hidden(); here?.closed() }
}
/** Back to one's own world: the page again, with no lobby in its ticket or its address. */
function home() {
  try { sessionStorage.removeItem(TICKET) } catch { /* nothing kept */ }
  const u = new URL(location.href)
  u.searchParams.delete('lobby'); u.searchParams.delete('name')
  if (u.href === location.href) location.reload(); else location.replace(u)
}

/** Opens the panel from the realm's settings: the server this page is in, or the list. */
export function open(s: Seam) {
  seam = { ...s, door: s.door ?? seam?.door ?? null }
  if (seam.door) { panel ??= build(); here ??= inLobby(panel, seam as Seam & { door: Door }); wire(panel); here.show(); panel.open(seam.input) } else openList()
}

// ── In a lobby ────────────────────────────────────────────────────────────

/** In a lobby: its tag in the corner, its notices, who is here, and the panel's view of it. */
export function inside(s: Seam & { door: Door }) {
  seam = s
  panel ??= build()
  wire(panel)
  here ??= inLobby(panel, seam as Seam & { door: Door })
}

function inLobby(p: NonNullable<typeof panel>, s: Seam & { door: Door }) {
  const { $ } = p, door = s.door
  const srv = { ...door.server, name: plain(door.server.name, 48) || 'A Village server', about: plain(door.server.about, 200) }
  // The tag: whose server this is, always, and a way to its panel.
  const tag = document.createElement('button')
  tag.id = 'lobby-tag'; tag.type = 'button'; tag.className = 'vx-button'
  tag.setAttribute('aria-haspopup', 'dialog')
  const lamp = document.createElement('span'), nm = document.createElement('span'), whose = document.createElement('span'), q = document.createElement('span')
  lamp.className = 'lamp'; lamp.setAttribute('aria-hidden', 'true'); nm.className = 'nm'; whose.className = 'q whose'; q.className = 'q n'
  for (const el of [whose, nm, q]) el.setAttribute('aria-hidden', 'true')
  nm.textContent = srv.name; whose.textContent = 'Visiting'
  const label = document.createElement('span')
  label.style.cssText = 'display:inline-flex;align-items:center;gap:8px;min-inline-size:0;max-inline-size:100%;overflow:hidden'
  label.append(lamp, whose, nm, q)
  tag.append(label)
  document.body.append(tag)
  if (p.kit) p.kit.adopt(tag); else void import(new URL('../kit/src/index.js', import.meta.url).href).then((k: Kit) => k.adopt(tag)).catch(() => {})
  tag.addEventListener('click', () => { show(); p.open(s.input) })
  addEventListener('pointerup', () => setTimeout(() => { if (document.activeElement === tag) tag.blur() }))

  const people = $<HTMLUListElement>('.people'), told = $<HTMLOListElement>('.told')
  let names: { name: string; me: boolean }[] = [], out = false, admin = false
  const toldMost = 50
  const tell = (text: string) => {
    const li = document.createElement('li'), t = document.createElement('time'), now = new Date()
    t.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    li.append(t, document.createTextNode(plain(text, 200)))
    told.prepend(li)
    while (told.children.length > toldMost) told.lastElementChild!.remove()
  }
  const drawTag = () => {
    q.textContent = out ? '' : names.length ? `${SEP}${names.length} here` : ''
    whose.textContent = out ? 'Out of' : 'Visiting'
    tag.setAttribute('aria-label', `${out ? 'Out of' : 'Visiting'} ${srv.name}, someone else’s server${!out && names.length ? `, ${names.length} here` : ''}. Open the server’s panel.`)
    lamp.classList.toggle('off', out)
  }
  const drawPeople = () => {
    people.replaceChildren(...names.map((n) => { const li = document.createElement('li'); li.textContent = n.name; if (n.me) { const m = document.createElement('span'); m.className = 'me'; m.textContent = ' (you)'; li.append(m) } return li }))
    $<HTMLElement>('.f-players').textContent = `${names.length} of ${srv.most}`
  }
  const ask = async () => {
    if (out) return
    const now = await door.people()
    if (!now.length && names.length) return
    const was = new Set(names.map((n) => n.name)), is = new Set(now.map((n) => n.name))
    if (names.length) { for (const n of now) if (!was.has(n.name)) tell(`${n.name} joined`); for (const n of names) if (!is.has(n.name)) tell(`${n.name} left`) }
    names = now
    drawTag(); drawPeople()
  }
  void ask()
  const every = setInterval(() => { if (document.visibilityState === 'visible') void ask() }, PEOPLE_EVERY)
  drawTag()
  // What the server says, kept here and said over the picture as before.
  door.ontold = (text) => { tell(text); if (p.d.open && p.view === 'here') return; s.hud.notice(`The server says: ${plain(text, 200)}`, 6000) }
  // The address's way in (a realm's preview, main.ts) says it in the door's banner as well; the ticket's keeps it in `early` until now.
  const was = door.ongone
  door.ongone = (why) => {
    if (early.gone === null && was) was(why)
    early.gone = null
    out = true
    clearInterval(every)
    drawTag()
    const told = /kicked/.test(why) ? `An admin of ${srv.name} kicked you out.` : /banned/.test(why) ? `An admin of ${srv.name} banned you from it.` : /stopping/.test(why) ? `${srv.name}’s host stopped the server.` : /another page/.test(why) ? `You joined ${srv.name} again from another tab or window, so this one is out.` : /nothing (has been )?heard|line to it|broke/.test(why) ? `${srv.name} stopped answering: its host’s machine or network is gone.` : plain(why, 240)
    line($<HTMLElement>('.out-line'), told, true)
    $<HTMLElement>('#lobbies-h').textContent = `Out of ${srv.name}`
    listing?.hidden()
    p.show('out')
    p.open(s.input)
    setTimeout(() => $<HTMLButtonElement>('.k-home').focus())
  }
  // Said before this room was up: told now.
  for (const t of early.told.splice(0)) door.ontold(t)
  if (early.gone) { const why = early.gone; early.gone = null; door.ongone(why) }

  const show = () => {
    if (out) { $<HTMLElement>('#lobbies-h').textContent = `Out of ${srv.name}`; p.show('out'); return }
    $<HTMLElement>('#lobbies-h').textContent = srv.name
    $<HTMLElement>('.sub').textContent = ''
    $<HTMLElement>('.srv').textContent = srv.name
    $<HTMLElement>('.about').textContent = srv.about
    $<HTMLElement>('.f-build').textContent = srv.build === 'admins' ? 'Admins only' : 'Everyone'
    drawPeople()
    // Who may build, as the server says now (an admin may have changed it since this page came in).
    void door.may().then((why) => { if (/only admins/.test(why ?? '')) srv.build = 'admins'; else if (!why) srv.build = 'everyone'; $<HTMLElement>('.f-build').textContent = srv.build === 'admins' ? 'Admins only' : 'Everyone' })
    $<HTMLElement>('.am').hidden = true
    listing?.hidden()
    $<HTMLElement>('.am-row').hidden = !srv.admins
    p.show('here')
    if (admin) { legend($<HTMLElement>('.k-admin'), 'Admin controls'); $<HTMLElement>('.am-row .truth').textContent = 'You are an admin here.' }
    void ask()
    setTimeout(() => $<HTMLButtonElement>('.k-close').focus())
  }
  // ── Becoming an admin, and the admin's controls (built once the server has said yes) ──
  const amIn = $<HTMLInputElement>('#lobbies-admin'), amDone = $<HTMLElement>('.am-done')
  const becoming = async () => {
    const password = amIn.value
    amIn.value = ''
    if (!password) { line(amDone, 'Type the admin password first.', true); amIn.focus(); return }
    line(amDone, 'Asking the server…')
    const a = await door.lobby.admin(password)
    if (a.ok !== true) { line(amDone, a.why === 'wrong password' ? 'That is not the admin password.' : `Not an admin: ${plain(a.why, 160)}.`, true); amIn.focus(); return }
    admin = true
    line(amDone, '')
    controls()
  }
  $<HTMLButtonElement>('.am-go').addEventListener('click', () => void becoming())
  amIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void becoming() } })
  let built: ReturnType<typeof adminControls> | null = null
  const controls = () => {
    built ??= adminControls(p, door, srv, () => { $<HTMLElement>('.f-build').textContent = srv.build === 'admins' ? 'Admins only' : 'Everyone'; nm.textContent = srv.name })
    $<HTMLElement>('#lobbies-h').textContent = `${srv.name}: admin`
    p.show('admin')
    built.shown()
  }
  return {
    show,
    asAdmin() {
      if (admin) return controls()
      const am = $<HTMLElement>('.am')
      am.hidden = false
      $<HTMLElement>('.am-row').hidden = true
      line(amDone, '')
      p.redraw()
      setTimeout(() => amIn.focus())
    },
    closed() { amIn.value = '' },
  }
}

function adminControls(p: NonNullable<typeof panel>, door: Door, srv: { name: string; about: string; most: number; build: string }, changed: () => void) {
  const sec = p.$<HTMLElement>('section[data-view="admin"]')
  sec.innerHTML = /* html */ `
    <p class="truth">You are an admin of this server until you leave it. What you do here is the server’s, for everyone in it.</p>
    <div class="admin">
      <div class="col">
      <div><h3 id="lobbies-players">Players</h3><ul class="players" aria-labelledby="lobbies-players"></ul><p class="done d-players" role="status"></p></div>
      <div><h3 id="lobbies-bans">Banned</h3><ul class="bans" aria-labelledby="lobbies-bans"></ul><p class="done d-bans" role="status"></p></div>
      <div class="rename"><h3><label for="lobbies-rename">Name</label></h3>
        <span class="vx-well"><input id="lobbies-rename" maxlength="48" autocomplete="off"></span>
        <h3><label for="lobbies-about">About</label></h3>
        <span class="vx-well"><input id="lobbies-about" maxlength="200" autocomplete="off" placeholder="what it is for"></span>
        <div><button class="vx-button rename-go" type="button"><span>Rename</span></button></div>
        <p class="done d-rename" role="status"></p></div>
      </div>
      <div class="col">
        <div><h3>Who may build</h3>
          <div class="vx-toggle-group build" role="radiogroup" aria-label="Who may build">
            <label><input type="radio" name="lobbies-build" value="everyone">Everyone</label>
            <label><input type="radio" name="lobbies-build" value="admins">Admins only</label>
          </div><p class="done d-build" role="status"></p></div>
        <div><h3><label for="lobbies-most">Player limit</label></h3>
          <div class="most"><span class="vx-well"><input id="lobbies-most" type="number" min="1" max="64" step="1" inputmode="numeric"></span><button class="vx-button most-go" type="button"><span>Set</span></button></div><p class="done d-most" role="status"></p></div>
      <div><h3><label for="lobbies-lock">The server’s password</label></h3>
        <div class="key"><span class="vx-well"><input id="lobbies-lock" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" maxlength="256" data-1p-ignore data-lpignore="true" data-bwignore placeholder="a new password"></span><button class="vx-button lock-go" type="button"><span>Set</span></button><button class="vx-button lock-off" type="button"><span>Clear</span></button></div>
        <p class="done d-lock" role="status"></p></div>
      <div><h3><label for="lobbies-say">Say as the server</label></h3>
        <div class="key"><span class="vx-well"><input id="lobbies-say" maxlength="200" autocomplete="off" enterkeyhint="send"></span><button class="vx-button say-go" type="button"><span>Say</span></button></div>
        <p class="done d-say" role="status"></p></div>
      </div>
    </div>`
  const $ = <T extends Element>(q: string) => sec.querySelector<T>(q)!
  const done = (cls: string, a: { ok?: true; why?: string }, ok: string) => { line($<HTMLElement>(`.d-${cls}`), a.ok === true ? ok : `Not done: ${plain(a.why ?? 'the server did not say', 160)}.`, a.ok !== true); return a.ok === true }
  const players = $<HTMLUListElement>('.players'), bans = $<HTMLUListElement>('.bans')
  const named = (n: unknown) => plain(n, 30) || 'someone'
  const who = async () => {
    const a = await door.lobby.who()
    if (a.ok !== true) return void done('players', a, '')
    const list = Array.isArray(a.people) ? (a.people as Record<string, unknown>[]).slice(0, 128) : []
    players.replaceChildren(...list.map((w) => {
      const li = document.createElement('li'), name = document.createElement('span'), id = typeof w.you === 'string' ? w.you : ''
      name.textContent = named(w.name)
      if (id === door.you || w.admin === true) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = id === door.you ? ' (you)' : ' (admin)'; name.append(t) }
      li.append(name)
      if (id && id !== door.you) {
        const kick = document.createElement('button'), ban = document.createElement('button')
        for (const [b, word] of [[kick, 'Kick'], [ban, 'Ban']] as const) { b.type = 'button'; b.className = 'vx-button'; const sp = document.createElement('span'); sp.textContent = word; b.append(sp); b.setAttribute('aria-label', `${word} ${named(w.name)}`) }
        ban.dataset.vxKind = 'danger'
        kick.addEventListener('click', async () => { if (done('players', await door.lobby.kick(id), `${named(w.name)} was kicked.`)) void who() })
        ban.addEventListener('click', async () => { if (done('players', await door.lobby.ban(id), `${named(w.name)} is banned.`)) { void who(); void banned() } })
        li.append(kick, ban)
      }
      return li
    }))
    p.redraw()
  }
  const banned = async () => {
    const a = await door.lobby.bans()
    if (a.ok !== true) return void done('bans', a, '')
    const list = Array.isArray(a.bans) ? (a.bans as Record<string, unknown>[]).slice(0, 256) : []
    if (!list.length) { const li = document.createElement('li'); li.className = 'none'; const sp = document.createElement('span'); sp.style.fontWeight = '400'; sp.style.color = 'var(--vx-ink-quiet)'; sp.textContent = 'Nobody is banned.'; li.append(sp); bans.replaceChildren(li); p.redraw(); return }
    bans.replaceChildren(...list.map((b) => {
      const li = document.createElement('li'), name = document.createElement('span'), id = typeof b.you === 'string' ? b.you : ''
      name.textContent = named(b.name || id)
      const lift = document.createElement('button'), sp = document.createElement('span')
      lift.type = 'button'; lift.className = 'vx-button'; sp.textContent = 'Lift'; lift.append(sp); lift.setAttribute('aria-label', `Lift the ban on ${named(b.name || id)}`)
      lift.addEventListener('click', async () => { if (done('bans', await door.lobby.unban(id), `The ban on ${named(b.name || id)} is lifted.`)) void banned() })
      li.append(name, lift)
      return li
    }))
    p.redraw()
  }
  for (const r of sec.querySelectorAll<HTMLInputElement>('input[name=lobbies-build]')) r.addEventListener('change', async () => {
    if (!r.checked) return
    const a = await door.lobby.build(r.value as 'everyone' | 'admins')
    if (done('build', a, r.value === 'admins' ? 'Only admins build now. Walking and talking stay everyone’s.' : 'Everyone builds now.')) { srv.build = r.value; changed() } else for (const x of sec.querySelectorAll<HTMLInputElement>('input[name=lobbies-build]')) x.checked = x.value === srv.build
  })
  const most = $<HTMLInputElement>('#lobbies-most')
  const setMost = async () => { const n = Math.floor(Number(most.value)); const a = await door.lobby.most(n); if (done('most', a, `At most ${n} players now.`)) { srv.most = n; changed() } }
  $<HTMLButtonElement>('.most-go').addEventListener('click', () => void setMost())
  most.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void setMost() } })
  const lock = $<HTMLInputElement>('#lobbies-lock')
  const setLock = async (on: boolean) => {
    const password = on ? lock.value : null
    lock.value = ''
    if (on && !password) { line($<HTMLElement>('.d-lock'), 'Type a password first.', true); lock.focus(); return }
    done('lock', await door.lobby.lock(password), on ? 'The server asks this password of whoever joins next.' : 'The server asks no password now.')
  }
  $<HTMLButtonElement>('.lock-go').addEventListener('click', () => void setLock(true))
  $<HTMLButtonElement>('.lock-off').addEventListener('click', () => void setLock(false))
  lock.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void setLock(true) } })
  const sayIn = $<HTMLInputElement>('#lobbies-say')
  const say = async () => { const text = sayIn.value.trim(); if (!text) { line($<HTMLElement>('.d-say'), 'Type something to say first.', true); return } if (done('say', await door.lobby.say(text), 'Said to everyone here.')) sayIn.value = '' }
  $<HTMLButtonElement>('.say-go').addEventListener('click', () => void say())
  sayIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void say() } })
  const nameIn = $<HTMLInputElement>('#lobbies-rename'), aboutIn = $<HTMLInputElement>('#lobbies-about')
  const rename = async () => {
    const name = nameIn.value.trim()
    if (done('rename', await door.lobby.rename(name, aboutIn.value.trim()), `The server is called ${plain(name, 48)} now.`)) { srv.name = plain(name, 48); srv.about = plain(aboutIn.value, 200); changed(); p.$<HTMLElement>('#lobbies-h').textContent = `${srv.name}: admin` }
  }
  $<HTMLButtonElement>('.rename-go').addEventListener('click', () => void rename())
  return {
    shown() {
      for (const x of sec.querySelectorAll<HTMLInputElement>('input[name=lobbies-build]')) x.checked = x.value === srv.build
      most.value = String(srv.most)
      nameIn.value = srv.name; aboutIn.value = srv.about
      for (const d of sec.querySelectorAll<HTMLElement>('.done')) line(d, '')
      void who(); void banned()
      p.redraw()
      setTimeout(() => sec.querySelector<HTMLElement>('.players button, .most-go')?.focus())
    },
  }
}

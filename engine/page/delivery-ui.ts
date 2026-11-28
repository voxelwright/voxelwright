// DoorSmash Smartphone App UI mounted inside the extensible PhoneOS (`phone.ts`).
// Five crisp tabs inside the handheld screen:
//   1. Orders  — Incoming dispatch offers (with distance, pay, upfront vs post tip, hazard tags) & Active stacked orders
//   2. Route   — Apple Maps / Google Maps–style reorderable multi-stop GPS + supermarket checklist + Hangouts
//   3. Cargo   — Death Stranding–style interactive spatial cargo grid (Move, Rotate, Seal Lid, Eat Food 🍔!)
//   4. Chat    — Live customer messages with quick replies, custom text, ignore, and send 🖕!
//   5. Garage  — Buy/equip E-Scooter, Moped, Prius Hybrid, Turbo Hatch + Paints, Lighting & Practical Upgrades + Driver Stars & 👍 Likes!
import { itemDims, type CargoItem } from './delivery-cargo.ts'
import type { DeliveryController } from './delivery.ts'
import {
  DELIVERY_LIGHTING,
  DELIVERY_PAINTS,
  DELIVERY_VEHICLES,
  getVehicleDef,
  PRACTICAL_UPGRADES,
  type DeliveryVehicleId,
} from './delivery-vehicles.ts'
import { formatDistance } from './gps.ts'
import type { PhoneApp } from './phone.ts'

type TabId = 'orders' | 'route' | 'cargo' | 'chat' | 'garage'

const STYLE = /* css */ `
.ds-app {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0d111a;
  color: #f3f6fb;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "IBM Plex Sans", system-ui, sans-serif;
}
.ds-hdr {
  flex: none;
  padding: 8px 12px 7px;
  background: linear-gradient(135deg, #c81d2b 0%, #991322 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ds-brand { display: flex; flex-direction: column; }
.ds-title { font: 900 14px/1 -apple-system, system-ui, sans-serif; letter-spacing: -0.02em; }
.ds-sub { font: 600 10px/1.2 -apple-system, system-ui, sans-serif; opacity: 0.86; margin-top: 2px; }
.ds-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ds-pill {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.28);
  white-space: nowrap;
}
.ds-pill.cash { color: #6ee7b7; }
.ds-pill.star { color: #fde047; }

.ds-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ds-card {
  padding: 10px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.09);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ds-card.offer { border-color: rgba(255, 77, 61, 0.45); background: linear-gradient(180deg, rgba(255, 77, 61, 0.12), rgba(255, 255, 255, 0.04)); }
.ds-card.market { border-color: rgba(56, 189, 248, 0.45); background: linear-gradient(180deg, rgba(56, 189, 248, 0.12), rgba(255, 255, 255, 0.04)); }
.ds-card.receipt { border-color: rgba(16, 185, 129, 0.52); background: linear-gradient(180deg, rgba(16, 185, 129, 0.14), rgba(255, 255, 255, 0.04)); }
.ds-card.warn { border-color: rgba(245, 158, 11, 0.55); background: rgba(245, 158, 11, 0.12); }

.ds-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.ds-name { font: 700 12.5px/1.2 -apple-system, system-ui, sans-serif; }
.ds-meta { font: 500 11px/1.25 -apple-system, system-ui, sans-serif; color: rgba(220, 230, 245, 0.72); }
.ds-pay { font: 800 14px/1 -apple-system, system-ui, sans-serif; color: #6ee7b7; }
.ds-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.ds-tag {
  padding: 2px 6px;
  border-radius: 6px;
  font: 700 9.5px/1.2 -apple-system, system-ui, sans-serif;
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}
.ds-tag.hot { background: rgba(249, 115, 22, 0.25); color: #fdba74; }
.ds-tag.liq { background: rgba(56, 189, 248, 0.25); color: #7dd3fc; }
.ds-tag.bad { background: rgba(239, 68, 68, 0.28); color: #fca5a5; }
.ds-tag.good { background: rgba(16, 185, 129, 0.25); color: #6ee7b7; }

.ds-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.ds-btn {
  flex: 1;
  min-width: 60px;
  padding: 7px 9px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.09);
  color: #f3f6fb;
  font: 700 11px/1.1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
  text-align: center;
}
.ds-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.17); }
.ds-btn:disabled { opacity: 0.4; cursor: default; }
.ds-btn.primary { background: #e63946; border-color: #ff6b6b; color: #fff; }
.ds-btn.primary:hover:not(:disabled) { background: #f24856; }
.ds-btn.green { background: #059669; border-color: #34d399; color: #fff; }
.ds-btn.amber { background: #b45309; border-color: #fbbf24; color: #fff; }
.ds-btn.danger { background: rgba(220, 38, 38, 0.3); border-color: rgba(248, 113, 113, 0.55); color: #fecaca; }
.ds-btn.sm { flex: none; padding: 5px 8px; font-size: 10.5px; min-width: 0; }

/* Cargo Bay Grid */
.ds-grid-wrap {
  display: grid;
  gap: 5px;
  padding: 8px;
  border-radius: 12px;
  background: #080b12;
  border: 1.5px solid rgba(255, 255, 255, 0.12);
}
.ds-cell {
  min-height: 46px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: rgba(200, 214, 234, 0.48);
  cursor: pointer;
  padding: 3px;
  text-align: center;
}
.ds-cell.thermal { border-color: rgba(249, 115, 22, 0.5); background: rgba(249, 115, 22, 0.09); color: #fdba74; }
.ds-cell.liquid { border-color: rgba(56, 189, 248, 0.5); background: rgba(56, 189, 248, 0.09); color: #7dd3fc; }
.ds-cell.occ {
  border-style: solid;
  border-color: rgba(110, 231, 183, 0.55);
  background: rgba(16, 185, 129, 0.18);
  color: #f8fafc;
}
.ds-cell.sel { box-shadow: 0 0 0 2px #fde047; }
.ds-cell.hazard { border-color: #ef4444; background: rgba(239, 68, 68, 0.24); }
.ds-bar {
  width: 100%;
  height: 4px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
  margin-top: 3px;
}
.ds-bar > i { display: block; height: 100%; background: #34d399; }
.ds-bar.low > i { background: #ef4444; }

/* Chat Bubbles */
.ds-msgs { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
.ds-msg {
  max-width: 86%;
  padding: 7px 10px;
  border-radius: 12px;
  font: 500 11.5px/1.3 -apple-system, system-ui, sans-serif;
}
.ds-msg.customer { align-self: flex-start; background: rgba(255, 255, 255, 0.11); color: #f3f6fb; border-bottom-left-radius: 4px; }
.ds-msg.driver { align-self: flex-end; background: #e63946; color: #fff; border-bottom-right-radius: 4px; }
.ds-msg.system { align-self: center; background: transparent; color: rgba(180, 196, 220, 0.65); font-size: 10.5px; text-align: center; }
.ds-chat-form { display: flex; gap: 5px; }
.ds-chat-input {
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font: 500 11.5px/1.2 -apple-system, system-ui, sans-serif;
  outline: none;
}

/* Paint Swatches */
.ds-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.ds-swatch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #eef3f8;
  font: 600 10px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
}
.ds-swatch.on { border-color: #fde047; background: rgba(253, 224, 71, 0.14); }
.ds-dot { width: 11px; height: 11px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.45); }

/* Bottom Tab Bar */
.ds-tabs {
  flex: none;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  background: #090c13;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  padding: 4px 4px 5px;
  gap: 2px;
}
.ds-tab {
  position: relative;
  border: 0;
  background: transparent;
  color: rgba(200, 214, 234, 0.62);
  font: 700 9.5px/1.15 -apple-system, system-ui, sans-serif;
  padding: 5px 2px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.ds-tab.on { color: #ff6b6b; background: rgba(255, 77, 61, 0.12); }
.ds-tab-ic { font-size: 13px; line-height: 1; }
.ds-tab-dot {
  position: absolute;
  top: 2px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff3b30;
}
`

const DOORSMASH_ICON = `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15.5c2.2-6 7-8.5 13-8.5 3.6 0 6.5 1.9 7 5.2H4v3.3z" fill="rgba(255,255,255,0.2)"/><path d="M3 18.5h22"/><circle cx="9" cy="21" r="2.1" fill="#fff"/><circle cx="19" cy="21" r="2.1" fill="#fff"/><path d="M12.5 5.5l1.5-2.5"/></svg>`

export function createDoorSmashApp(ctrl: DeliveryController): PhoneApp {
  return {
    id: 'doorsmash',
    name: 'DoorSmash',
    subtitle: 'SF Food & Market Delivery',
    accent: 'linear-gradient(145deg, #ff4d3d 0%, #b91c1c 100%)',
    iconSvg: DOORSMASH_ICON,
    order: 1,
    badge: () => {
      const unread = ctrl.activeOrders.reduce((n, o) => n + o.unreadChat, 0)
      const count = unread + ctrl.offers.length
      return count > 0 ? count : null
    },
    mount(container, ctx) {
      if (typeof document !== 'undefined' && !document.getElementById('vw-doorsmash-style')) {
        const st = document.createElement('style')
        st.id = 'vw-doorsmash-style'
        st.textContent = STYLE
        document.head.append(st)
      }

      let tab: TabId = 'orders'
      let selectedItemId: string | null = null
      let selectedChatOrderId: string | null = null
      let shopNotice = ''

      const root = document.createElement('div')
      root.className = 'ds-app'
      root.innerHTML = `
        <div class="ds-hdr">
          <div class="ds-brand">
            <div class="ds-title">DOORSMASH</div>
            <div class="ds-sub"></div>
          </div>
          <div class="ds-stats">
            <span class="ds-pill star"></span>
            <span class="ds-pill cash"></span>
          </div>
        </div>
        <div class="ds-scroll"></div>
        <div class="ds-tabs">
          <button type="button" class="ds-tab on" data-tab="orders"><span class="ds-tab-ic">🛵</span><span>Orders</span></button>
          <button type="button" class="ds-tab" data-tab="route"><span class="ds-tab-ic">🗺️</span><span>GPS</span></button>
          <button type="button" class="ds-tab" data-tab="cargo"><span class="ds-tab-ic">📦</span><span>Cargo</span></button>
          <button type="button" class="ds-tab" data-tab="chat"><span class="ds-tab-ic">💬</span><span>Chat</span></button>
          <button type="button" class="ds-tab" data-tab="garage"><span class="ds-tab-ic">🔧</span><span>Garage</span></button>
        </div>
      `
      container.append(root)

      const subEl = root.querySelector<HTMLElement>('.ds-sub')!
      const starEl = root.querySelector<HTMLElement>('.ds-pill.star')!
      const cashEl = root.querySelector<HTMLElement>('.ds-pill.cash')!
      const scrollEl = root.querySelector<HTMLElement>('.ds-scroll')!
      const tabBtns = [...root.querySelectorAll<HTMLButtonElement>('.ds-tab')]

      for (const b of tabBtns) {
        b.addEventListener('click', () => {
          tab = (b.dataset.tab as TabId) ?? 'orders'
          ctx.sfx('tap')
          render()
        })
      }

      const renderOrdersTab = () => {
        // Show latest delivery receipt summary if just finished
        if (ctrl.lastReceipt && performance.now() - ctrl.lastReceipt.atMs < 45_000) {
          const r = ctrl.lastReceipt
          const card = document.createElement('div')
          card.className = 'ds-card receipt'
          card.innerHTML = `
            <div class="ds-row"><span class="ds-name">Delivered · ${r.storeName}</span><span class="ds-pay">+$${r.totalPay.toFixed(2)}</span></div>
            <div class="ds-meta">Base $${r.basePay.toFixed(2)} · Time +$${r.timeBonus.toFixed(2)} · Cond +$${r.conditionBonus.toFixed(2)} · Style +$${r.styleBonus.toFixed(2)} · Tip +$${r.tip.toFixed(2)}</div>
            <div class="ds-row"><span class="ds-tag good">${r.starsEarned.toFixed(1)}★ · Score ${r.score}/100</span><span class="ds-tag liq">+${r.likesEarned} 👍 Likes</span></div>
            <div class="ds-meta">${r.review}</div>
          `
          scrollEl.append(card)
        }

        // Active stacked deliveries
        if (ctrl.activeOrders.length) {
          const h = document.createElement('div')
          h.className = 'ds-meta'
          h.textContent = `ACTIVE STACK (${ctrl.activeOrders.length}/4)`
          scrollEl.append(h)

          for (const ord of ctrl.activeOrders) {
            const remS = Math.max(0, Math.round((ord.deadlineAt - performance.now()) / 1000))
            const card = document.createElement('div')
            card.className = `ds-card ${ord.isSupermarket ? 'market' : ''}`
            const statusText =
              ord.status === 'in_transit' ? 'In transit → Drop-off'
              : ord.status === 'waiting_delay' ? `Delayed (${Math.ceil(ord.delayRemaining)}s)`
              : ord.isSupermarket ? `Shop ${ord.shoppingList.filter((i) => i.collected).length}/${ord.shoppingList.length} aisles`
              : 'Head to Pickup'
            card.innerHTML = `
              <div class="ds-row"><span class="ds-name"></span><span class="ds-tag ${ord.status === 'in_transit' ? 'good' : 'hot'}">${statusText}</span></div>
              <div class="ds-meta"></div>
              <div class="ds-tags"></div>
              <div class="ds-btns"></div>
            `
            card.querySelector('.ds-name')!.textContent = `${ord.store.name} (${ord.code})`
            card.querySelector('.ds-meta')!.textContent = `→ ${ord.customerName} · ${ord.dropoff.address} · ${remS}s left`
            const tags = card.querySelector('.ds-tags')!
            if (ord.restaurantTrait === 'obnoxious' && ord.status !== 'in_transit') tags.innerHTML += `<span class="ds-tag bad">Slow Kitchen</span>`
            if (ord.doubleParkedPickup || ord.doubleParkedDropoff) tags.innerHTML += `<span class="ds-tag good">🚨 Double-Parked</span>`
            if (ord.unreadChat > 0) tags.innerHTML += `<span class="ds-tag hot">${ord.unreadChat} new msg</span>`

            const btns = card.querySelector('.ds-btns')!
            if (ord.status !== 'in_transit') {
              const enterBtn = document.createElement('button')
              enterBtn.type = 'button'
              enterBtn.className = 'ds-btn primary'
              enterBtn.textContent = ord.isSupermarket ? 'Enter Store' : 'Enter / Pickup'
              enterBtn.addEventListener('click', () => {
                ctrl.enterStore(ord.store)
                render()
              })
              btns.append(enterBtn)
            } else {
              const cargoBtn = document.createElement('button')
              cargoBtn.type = 'button'
              cargoBtn.className = 'ds-btn amber'
              cargoBtn.textContent = 'Cargo / Eat'
              cargoBtn.addEventListener('click', () => { tab = 'cargo'; render() })
              btns.append(cargoBtn)
            }
            const chatBtn = document.createElement('button')
            chatBtn.type = 'button'
            chatBtn.className = 'ds-btn'
            chatBtn.textContent = `Chat${ord.unreadChat ? ` (${ord.unreadChat})` : ''}`
            chatBtn.addEventListener('click', () => { selectedChatOrderId = ord.id; tab = 'chat'; render() })
            btns.append(chatBtn)

            const cancelBtn = document.createElement('button')
            cancelBtn.type = 'button'
            cancelBtn.className = 'ds-btn sm danger'
            cancelBtn.textContent = '✕'
            cancelBtn.title = 'Unassign / Cancel order'
            cancelBtn.addEventListener('click', () => ctrl.cancelOrder(ord.id))
            btns.append(cancelBtn)
            scrollEl.append(card)
          }
        }

        // Incoming offers
        const oh = document.createElement('div')
        oh.className = 'ds-row'
        oh.innerHTML = `<span class="ds-meta">INCOMING OFFERS (${ctrl.offers.length})</span>`
        const findBtn = document.createElement('button')
        findBtn.type = 'button'
        findBtn.className = 'ds-btn sm'
        findBtn.textContent = '+ Ping Orders'
        findBtn.addEventListener('click', () => ctrl.generateOffer())
        oh.append(findBtn)
        scrollEl.append(oh)

        if (!ctrl.offers.length) {
          const empty = document.createElement('div')
          empty.className = 'ds-card'
          empty.innerHTML = `<div class="ds-meta">Scanning nearby SF restaurants & supermarkets… Tap "+ Ping Orders" or visit a Driver Hangout for surge pings.</div>`
          scrollEl.append(empty)
        }

        for (const off of ctrl.offers) {
          const card = document.createElement('div')
          card.className = `ds-card ${off.isSupermarket ? 'market' : 'offer'}`
          const shownPay = off.basePay + off.upfrontTip
          card.innerHTML = `
            <div class="ds-row">
              <span class="ds-name"></span>
              <span class="ds-pay">$${shownPay.toFixed(2)}</span>
            </div>
            <div class="ds-meta"></div>
            <div class="ds-tags"></div>
            <div class="ds-btns">
              <button type="button" class="ds-btn primary ds-acc">Accept</button>
              <button type="button" class="ds-btn sm ds-dec">Decline</button>
            </div>
          `
          card.querySelector('.ds-name')!.textContent = `${off.isSupermarket ? '🛒 ' : ''}${off.store.name}`
          const tipTxt = off.upfrontTip > 0 ? `incl. $${off.upfrontTip.toFixed(2)} upfront tip` : 'customer tips after'
          card.querySelector('.ds-meta')!.textContent = `${formatDistance(off.distanceM)} · ${off.etaSeconds}s ETA · ${tipTxt} · → ${off.dropoff.address}`
          const tags = card.querySelector('.ds-tags')!
          for (const sp of off.itemSpecs) {
            const cls = sp.kind === 'pizza' ? 'hot' : sp.isLiquid ? 'liq' : ''
            const note = sp.kind === 'pizza' ? ' · FLAT' : sp.isLiquid ? ' · SEAL' : sp.fragile ? ' · FRAGILE' : ''
            tags.innerHTML += `<span class="ds-tag ${cls}">${sp.emoji} ${sp.name}${note}</span>`
          }
          if (off.isSupermarket) tags.innerHTML += `<span class="ds-tag liq">${off.shoppingList.length} Aisle Items</span>`
          if (off.restaurantTrait === 'obnoxious') tags.innerHTML += `<span class="ds-tag bad">Busy / Slow Prep</span>`
          if (off.customerTrait === 'obnoxious') tags.innerHTML += `<span class="ds-tag bad">Picky Customer</span>`
          if (off.customerTrait === 'generous') tags.innerHTML += `<span class="ds-tag good">High Tipper</span>`

          card.querySelector('.ds-acc')!.addEventListener('click', () => ctrl.acceptOffer(off.id))
          card.querySelector('.ds-dec')!.addEventListener('click', () => ctrl.declineOffer(off.id))
          scrollEl.append(card)
        }
      }

      const renderRouteTab = () => {
        // Multi-stop GPS reorderer (Apple Maps / Google Maps style)
        const card = document.createElement('div')
        card.className = 'ds-card'
        card.innerHTML = `<div class="ds-row"><span class="ds-name">Multi-Stop GPS (${ctrl.routeStops.length})</span><span class="ds-meta">Reorder ↑↓</span></div>`
        if (!ctrl.routeStops.length) {
          card.innerHTML += `<div class="ds-meta">Accept one or more orders to build your multi-stop SF route. Reorder stops anytime like Apple Maps / Google Maps.</div>`
        } else {
          ctrl.routeStops.forEach((st, idx) => {
            const row = document.createElement('div')
            row.className = 'ds-row'
            row.style.cssText = 'padding:6px 7px;border-radius:9px;background:rgba(255,255,255,0.05);'
            const badgeCol = st.accent ?? '#ff4d3d'
            row.innerHTML = `
              <span style="width:19px;height:19px;border-radius:50%;background:${badgeCol};color:#fff;font:800 10.5px/19px system-ui;text-align:center;flex:none;">${idx + 1}</span>
              <div style="flex:1;min-width:0;">
                <div class="ds-name" style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
                <div class="ds-meta" style="font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
              </div>
              <div style="display:flex;gap:3px;flex:none;">
                <button type="button" class="ds-btn sm r-up" ${idx === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="ds-btn sm r-dn" ${idx === ctrl.routeStops.length - 1 ? 'disabled' : ''}>↓</button>
              </div>
            `
            row.querySelector('.ds-name')!.textContent = st.name
            row.querySelector('.ds-meta')!.textContent = st.subtitle ?? ''
            row.querySelector('.r-up')!.addEventListener('click', () => ctrl.reorderStop(idx, idx - 1))
            row.querySelector('.r-dn')!.addEventListener('click', () => ctrl.reorderStop(idx, idx + 1))
            card.append(row)
          })
        }
        scrollEl.append(card)

        // Active Supermarket Shopping Checklists
        for (const ord of ctrl.activeOrders) {
          if (!ord.isSupermarket || ord.status === 'in_transit') continue
          const sc = document.createElement('div')
          sc.className = 'ds-card market'
          sc.innerHTML = `<div class="ds-row"><span class="ds-name">🛒 ${ord.store.name} Checklist</span><span class="ds-tag liq">${ord.shoppingList.filter((i) => i.collected).length}/${ord.shoppingList.length}</span></div>`
          for (const it of ord.shoppingList) {
            const r = document.createElement('div')
            r.className = 'ds-row'
            r.innerHTML = `<span class="ds-meta" style="${it.collected ? 'text-decoration:line-through;opacity:0.55;' : 'color:#f8fafc;'}">Aisle ${it.aisleNumber} (${it.aisleName}): ${it.name}</span><span class="ds-tag ${it.collected ? 'good' : ''}">${it.collected ? '✓ Bought' : 'Need'}</span>`
            sc.append(r)
          }
          scrollEl.append(sc)
        }

        // Delivery Driver Hangout Spots
        const hc = document.createElement('div')
        hc.className = 'ds-card'
        hc.innerHTML = `<div class="ds-row"><span class="ds-name">🛵 Courier Hangout Spots</span><span class="ds-tag liq">👍 Likes + Surge</span></div>`
        for (const h of ctrl.hangouts.slice(0, 4)) {
          const r = document.createElement('div')
          r.className = 'ds-row'
          r.style.cssText = 'padding:5px 0;border-top:1px solid rgba(255,255,255,0.06);'
          r.innerHTML = `<div style="min-width:0;flex:1;"><div class="ds-name" style="font-size:11px;">${h.name}</div><div class="ds-meta" style="font-size:10px;">${h.neighborhood} · ${h.driverCount} drivers waiting</div></div>`
          const goBtn = document.createElement('button')
          goBtn.type = 'button'
          goBtn.className = 'ds-btn sm'
          goBtn.textContent = 'GPS'
          goBtn.addEventListener('click', () => {
            ctrl.reorderStop(0, 0)
            ctx.notify({ appId: 'doorsmash', title: h.name, body: h.hotTip, accent: '#f59e0b', sound: 'tap' })
          })
          r.append(goBtn)
          hc.append(r)
        }
        scrollEl.append(hc)
      }

      const renderCargoTab = () => {
        const snap = ctrl.cargo.snapshot()
        const vDef = getVehicleDef(ctrl.profile.activeVehicle)

        if (snap.warnings.length) {
          const wc = document.createElement('div')
          wc.className = 'ds-card warn'
          wc.innerHTML = `<div class="ds-name">⚠️ Cargo Warning</div>${snap.warnings.map((w) => `<div class="ds-meta" style="color:#fef3c7;">• ${w}</div>`).join('')}`
          scrollEl.append(wc)
        }

        const hdr = document.createElement('div')
        hdr.className = 'ds-row'
        hdr.innerHTML = `<span class="ds-name">${vDef.name} Cargo (${snap.cols}×${snap.rows})</span><span class="ds-meta">Top=Light · Bottom=Heavy</span>`
        scrollEl.append(hdr)

        // Spatial 2D Cargo Bay Grid (Death Stranding style!)
        const grid = document.createElement('div')
        grid.className = 'ds-grid-wrap'
        grid.style.gridTemplateColumns = `repeat(${snap.cols}, 1fr)`

        const itemAt = (cx: number, cy: number): CargoItem | null => {
          for (const it of snap.items) {
            if (it.x === null || it.y === null) continue
            const [w, h] = itemDims(it)
            if (cx >= it.x && cx < it.x + w && cy >= it.y && cy < it.y + h) return it
          }
          return null
        }

        for (let y = 0; y < snap.rows; y++) {
          for (let x = 0; x < snap.cols; x++) {
            const role = snap.slots[y * snap.cols + x]
            const occ = itemAt(x, y)
            const cell = document.createElement('button')
            cell.type = 'button'
            cell.className = `ds-cell ${role === 'thermal' ? 'thermal' : role === 'liquid' ? 'liquid' : ''} ${occ ? 'occ' : ''} ${occ?.id === selectedItemId ? 'sel' : ''} ${occ?.hazard ? 'hazard' : ''}`
            if (occ) {
              const intPct = Math.round(occ.integrity)
              cell.innerHTML = `
                <div style="font-size:15px;line-height:1;">${occ.emoji}${occ.rotated ? '↕' : ''}</div>
                <div style="font:700 9.5px/1.1 system-ui;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${occ.name.split(' ')[0]}</div>
                <div class="ds-bar ${intPct < 55 ? 'low' : ''}"><i style="width:${intPct}%"></i></div>
              `
              cell.addEventListener('click', () => {
                selectedItemId = selectedItemId === occ.id ? null : occ.id
                ctx.sfx('tap')
                render()
              })
            } else {
              cell.textContent = role === 'thermal' ? '🔥 Pizza' : role === 'liquid' ? '🥤 Mount' : 'Empty'
              cell.addEventListener('click', () => {
                if (selectedItemId) {
                  ctrl.moveCargoItem(selectedItemId, x, y)
                  render()
                }
              })
            }
            grid.append(cell)
          }
        }
        scrollEl.append(grid)

        // Loose unpacked items if over-stacked
        const loose = snap.items.filter((i) => i.x === null)
        if (loose.length) {
          const lc = document.createElement('div')
          lc.className = 'ds-card warn'
          lc.innerHTML = `<div class="ds-name">Loose Items (${loose.length}) — tap item then tap empty slot</div>`
          const row = document.createElement('div')
          row.className = 'ds-btns'
          for (const it of loose) {
            const b = document.createElement('button')
            b.type = 'button'
            b.className = `ds-btn sm ${selectedItemId === it.id ? 'amber' : ''}`
            b.textContent = `${it.emoji} ${it.name}`
            b.addEventListener('click', () => { selectedItemId = it.id; render() })
            row.append(b)
          }
          lc.append(row)
          scrollEl.append(lc)
        }

        // Inspector & Actions for Selected Cargo Item (Seal Lid, Rotate Flat/Vertical, Eat Customer's Food!)
        const sel = snap.items.find((i) => i.id === selectedItemId) ?? snap.items[0] ?? null
        if (sel) {
          selectedItemId = sel.id
          const ic = document.createElement('div')
          ic.className = 'ds-card'
          const [w, h] = itemDims(sel)
          ic.innerHTML = `
            <div class="ds-row">
              <span class="ds-name">${sel.emoji} ${sel.name}</span>
              <span class="ds-tag ${sel.integrity < 60 ? 'bad' : 'good'}">${Math.round(sel.integrity)}% · ${w}×${h}</span>
            </div>
            <div class="ds-meta">${sel.hazard ?? (sel.hot ? `Hot (${Math.round(sel.temp)}%)` : sel.cold ? `Chilled (${Math.round(sel.temp)}%)` : 'Packed safely')} · Weight ${sel.weight}</div>
            <div class="ds-btns"></div>
          `
          const btns = ic.querySelector('.ds-btns')!
          if (sel.isLiquid && !sel.sealed) {
            const sb = document.createElement('button')
            sb.type = 'button'
            sb.className = 'ds-btn green'
            sb.textContent = '🔒 Seal Lid'
            sb.addEventListener('click', () => ctrl.sealCargoItem(sel.id))
            btns.append(sb)
          }
          const rb = document.createElement('button')
          rb.type = 'button'
          rb.className = 'ds-btn'
          rb.textContent = sel.rotated ? '↺ Lay Flat' : '↻ Rotate 90°'
          rb.addEventListener('click', () => ctrl.rotateCargoItem(sel.id))
          btns.append(rb)

          const eb = document.createElement('button')
          eb.type = 'button'
          eb.className = 'ds-btn danger'
          eb.textContent = sel.eaten >= 1 ? 'Eaten 😋' : sel.eaten > 0 ? '🍔 Finish It' : '🍔 Eat Food'
          eb.disabled = sel.eaten >= 1
          eb.addEventListener('click', () => ctrl.eatCargoItem(sel.id))
          btns.append(eb)
          scrollEl.append(ic)
        } else {
          const em = document.createElement('div')
          em.className = 'ds-card'
          em.innerHTML = `<div class="ds-meta">Cargo bay empty. Pick up food or groceries to pack them Death Stranding style — keep pizzas flat, seal soups, and put heavy bags on the bottom!</div>`
          scrollEl.append(em)
        }
      }

      const renderChatTab = () => {
        if (!ctrl.activeOrders.length) {
          scrollEl.innerHTML = `<div class="ds-card"><div class="ds-meta">No active customers yet. Accept an order to chat with customers (or ignore them, or send 🖕).</div></div>`
          return
        }
        // Order thread pills
        if (ctrl.activeOrders.length > 1) {
          const bar = document.createElement('div')
          bar.className = 'ds-btns'
          for (const o of ctrl.activeOrders) {
            const b = document.createElement('button')
            b.type = 'button'
            b.className = `ds-btn sm ${o.id === selectedChatOrderId ? 'primary' : ''}`
            b.textContent = `${o.customerName}${o.unreadChat ? ` (${o.unreadChat})` : ''}`
            b.addEventListener('click', () => { selectedChatOrderId = o.id; render() })
            bar.append(b)
          }
          scrollEl.append(bar)
        }
        const ord = ctrl.activeOrders.find((o) => o.id === selectedChatOrderId) ?? ctrl.activeOrders[0]
        selectedChatOrderId = ord.id
        ord.unreadChat = 0

        const card = document.createElement('div')
        card.className = 'ds-card'
        card.innerHTML = `
          <div class="ds-row">
            <span class="ds-name">${ord.customerName} (${ord.code})</span>
            <span class="ds-tag ${ord.customerTrait === 'obnoxious' ? 'bad' : 'good'}">${ord.customerTrait}</span>
          </div>
          <div class="ds-msgs"></div>
          <div class="ds-btns">
            <button type="button" class="ds-btn sm q-omw">On my way!</button>
            <button type="button" class="ds-btn sm q-got">Got it 👍</button>
            <button type="button" class="ds-btn sm danger q-mf" title="Send middle finger">🖕</button>
          </div>
          <form class="ds-chat-form">
            <input class="ds-chat-input" type="text" placeholder="Reply to customer (or ignore)..." maxlength="120">
            <button type="submit" class="ds-btn sm primary">Send</button>
          </form>
        `
        const msgs = card.querySelector('.ds-msgs')!
        for (const m of ord.chat) {
          const b = document.createElement('div')
          b.className = `ds-msg ${m.from}`
          b.textContent = m.text
          msgs.append(b)
        }
        card.querySelector('.q-omw')!.addEventListener('click', () => ctrl.replyToOrder(ord.id, 'On my way now!'))
        card.querySelector('.q-got')!.addEventListener('click', () => ctrl.replyToOrder(ord.id, 'Got it, will do 👍'))
        card.querySelector('.q-mf')!.addEventListener('click', () => ctrl.sendMiddleFinger(ord.id))
        const form = card.querySelector<HTMLFormElement>('.ds-chat-form')!
        const inp = card.querySelector<HTMLInputElement>('.ds-chat-input')!
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          if (inp.value.trim()) {
            ctrl.replyToOrder(ord.id, inp.value.trim())
            inp.value = ''
          }
        })
        scrollEl.append(card)
      }

      const renderGarageTab = () => {
        const p = ctrl.profile
        const curUp = p.upgrades[p.activeVehicle]
        // Driver Score & Death Stranding Likes summary card
        const profCard = document.createElement('div')
        profCard.className = 'ds-card'
        profCard.innerHTML = `
          <div class="ds-row">
            <span class="ds-name">${ctrl.rank}</span>
            <span class="ds-tag liq">👍 ${p.likes} Likes</span>
          </div>
          <div class="ds-meta">★ ${p.stars.toFixed(2)} rating · ${p.completed} deliveries · ${p.doubleParks} double-parks · ${p.eatenCount} stolen bites</div>
          ${shopNotice ? `<div class="ds-tag good">${shopNotice}</div>` : ''}
        `
        const spawnBtn = document.createElement('button')
        spawnBtn.type = 'button'
        spawnBtn.className = 'ds-btn primary'
        spawnBtn.textContent = `Spawn ${getVehicleDef(p.activeVehicle).name} at Curb`
        spawnBtn.addEventListener('click', () => {
          void ctrl.spawnActiveVehicle()
        })
        profCard.append(spawnBtn)
        scrollEl.append(profCard)

        // Vehicles catalog
        const vh = document.createElement('div')
        vh.className = 'ds-meta'
        vh.textContent = 'DELIVERY FLEET'
        scrollEl.append(vh)
        for (const v of DELIVERY_VEHICLES) {
          const owned = p.ownedVehicles.includes(v.id)
          const equipped = p.activeVehicle === v.id
          const vc = document.createElement('div')
          vc.className = 'ds-card'
          vc.innerHTML = `
            <div class="ds-row">
              <span class="ds-name">${v.name}</span>
              <span class="ds-tag ${equipped ? 'good' : ''}">${equipped ? 'ACTIVE' : owned ? 'OWNED' : `$${v.cost}`}</span>
            </div>
            <div class="ds-meta">${v.tagline} · ${v.topKmh} km/h · ${v.baseGrid[0]}×${v.baseGrid[1]} bay</div>
          `
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = `ds-btn ${equipped ? '' : owned ? 'green' : 'primary'}`
          btn.textContent = equipped ? 'Equipped' : owned ? 'Switch to Vehicle' : `Buy ($${v.cost})`
          btn.disabled = equipped || (!owned && p.cash < v.cost)
          btn.addEventListener('click', () => {
            const res = ctrl.selectOrBuyVehicle(v.id as DeliveryVehicleId)
            shopNotice = res.message
            render()
          })
          vc.append(btn)
          scrollEl.append(vc)
        }

        // Practical Upgrades
        const uh = document.createElement('div')
        uh.className = 'ds-meta'
        uh.textContent = 'PRACTICAL CARGO & MOUNT UPGRADES'
        scrollEl.append(uh)
        for (const key of Object.keys(PRACTICAL_UPGRADES) as (keyof typeof PRACTICAL_UPGRADES)[]) {
          const spec = PRACTICAL_UPGRADES[key]
          const lvl = curUp[key]
          const maxed = lvl >= spec.max
          const cost = maxed ? 0 : spec.costs[lvl]
          const uc = document.createElement('div')
          uc.className = 'ds-card'
          uc.innerHTML = `
            <div class="ds-row"><span class="ds-name">${spec.name}</span><span class="ds-tag ${maxed ? 'good' : 'hot'}">Lv.${lvl}/${spec.max}</span></div>
            <div class="ds-meta">${spec.desc}</div>
          `
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'ds-btn amber'
          btn.textContent = maxed ? 'Maxed Out ✓' : `Install Lv.${lvl + 1} ($${cost})`
          btn.disabled = maxed || p.cash < cost
          btn.addEventListener('click', () => {
            const res = ctrl.buyUpgrade(key)
            shopNotice = res.message
            render()
          })
          uc.append(btn)
          scrollEl.append(uc)
        }

        // Visual Paint & Lighting Kits
        const vis = document.createElement('div')
        vis.className = 'ds-card'
        vis.innerHTML = `<div class="ds-name">🎨 Paint & 💡 Lighting Kits</div>`
        const sw = document.createElement('div')
        sw.className = 'ds-swatches'
        for (const pt of DELIVERY_PAINTS) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = `ds-swatch ${curUp.paint === pt.id ? 'on' : ''}`
          b.innerHTML = `<span class="ds-dot" style="background:${pt.hex}"></span><span>${pt.name}${pt.cost && curUp.paint !== pt.id ? ` $${pt.cost}` : ''}</span>`
          b.addEventListener('click', () => { shopNotice = ctrl.buyPaint(pt.id).message; render() })
          sw.append(b)
        }
        vis.append(sw)

        const ltRow = document.createElement('div')
        ltRow.className = 'ds-btns'
        ltRow.style.marginTop = '4px'
        for (const lt of DELIVERY_LIGHTING) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = `ds-btn sm ${curUp.lighting === lt.id ? 'green' : ''}`
          b.textContent = `${lt.name}${lt.cost && curUp.lighting !== lt.id ? ` $${lt.cost}` : ''}`
          b.addEventListener('click', () => { shopNotice = ctrl.buyLighting(lt.id).message; render() })
          ltRow.append(b)
        }
        vis.append(ltRow)
        scrollEl.append(vis)
      }

      const render = () => {
        const p = ctrl.profile
        subEl.textContent = `${ctrl.rank} · 👍 ${p.likes}`
        starEl.textContent = `★ ${p.stars.toFixed(2)}`
        cashEl.textContent = `$${p.cash.toFixed(0)}`

        const unread = ctrl.activeOrders.reduce((n, o) => n + o.unreadChat, 0)
        const warnings = ctrl.cargo.snapshot().warnings.length
        for (const b of tabBtns) {
          const t = b.dataset.tab as TabId
          b.classList.toggle('on', t === tab)
          b.querySelector('.ds-tab-dot')?.remove()
          if ((t === 'chat' && unread > 0) || (t === 'cargo' && warnings > 0) || (t === 'orders' && ctrl.offers.length > 0)) {
            const dot = document.createElement('span')
            dot.className = 'ds-tab-dot'
            b.append(dot)
          }
        }
        ctx.setBadge(unread + ctrl.offers.length || null)

        scrollEl.replaceChildren()
        if (tab === 'orders') renderOrdersTab()
        else if (tab === 'route') renderRouteTab()
        else if (tab === 'cargo') renderCargoTab()
        else if (tab === 'chat') renderChatTab()
        else renderGarageTab()
      }

      const unsub = ctrl.subscribe(render)
      render()

      return {
        onShow() { render() },
        onTick() {
          // Keep timers fresh in orders tab
          if (tab === 'orders' && ctrl.activeOrders.length) {
            // lightweight refresh handled on state changes
          }
        },
        destroy() {
          unsub()
          root.remove()
        },
      }
    },
  }
}

//! Everything the master knows, in memory only: lobbies, joins in flight, and
//! per-address counts. One mutex; nothing is held across an await.

use std::collections::{BTreeMap, HashMap};
use std::net::IpAddr;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::{mpsc, oneshot};

use crate::config::Config;
use crate::text;

pub type Shared = Arc<State>;

pub struct State {
    pub cfg: Config,
    pub admin_token: Option<String>,
    inner: Mutex<Inner>,
}

#[derive(Default)]
pub struct Inner {
    /// By id, in order, so the list pages by `after=<id>`.
    pub lobbies: BTreeMap<String, Lobby>,
    pub codes: HashMap<String, String>,
    /// Host sockets open, with or without a hello.
    pub slots: usize,
    pub conns: usize,
    pub addrs: HashMap<IpAddr, Addr>,
    /// Lobby slots and connections held from each IPv6 /48, which may hold 256 /56s.
    pub groups: HashMap<[u16; 3], Group>,
    /// STUN requests per address, kept apart so UDP (whose source can be forged)
    /// can never fill the table HTTP admission reads.
    pub stun: HashMap<IpAddr, (Instant, u32)>,
    pub bans: HashMap<IpAddr, Instant>,
}

#[derive(Default)]
pub struct Group {
    pub slots: u32,
    pub conns: u32,
}

fn group_of(key: IpAddr) -> Option<[u16; 3]> {
    match key {
        IpAddr::V6(v6) => {
            let s = v6.segments();
            Some([s[0], s[1], s[2]])
        }
        IpAddr::V4(_) => None,
    }
}

/// What the master tells a host.
/// What the master tells a host. Taking a lobby off drops its sender, which
/// closes the host's socket.
pub enum ToHost {
    Offer { n: u64, sdp: String },
}

pub enum Reply {
    Answer(String),
    Refuse(String),
}

#[derive(Serialize, Clone)]
pub struct Record {
    pub id: String,
    pub name: String,
    pub about: String,
    pub pin: String,
    pub players: u32,
    pub most: u32,
    pub locked: bool,
    /// Unix seconds when the lobby said hello.
    pub since: u64,
}

pub struct Lobby {
    pub rec: Record,
    pub code: String,
    pub listed: bool,
    pub addr: IpAddr,
    pub tx: mpsc::Sender<ToHost>,
    pub pending: HashMap<u64, oneshot::Sender<Reply>>,
    pub next_n: u64,
}

/// One address's counts. Windows are fixed minutes.
pub struct Addr {
    pub slots: u32,
    pub conns: u32,
    window: Instant,
    pub registrations: u32,
    pub joins: u32,
    pub lookups: u32,
}

#[derive(Clone, Copy)]
pub enum Kind {
    Registration,
    Join,
    Lookup,
}

pub enum Refused {
    Banned,
    Limit(&'static str),
    Busy,
}

const MINUTE: Duration = Duration::from_secs(60);

impl State {
    pub fn new(cfg: Config, admin_token: Option<String>) -> Shared {
        Arc::new(State {
            cfg,
            admin_token,
            inner: Mutex::new(Inner::default()),
        })
    }

    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves plain data behind; keep serving.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Count one request of `kind` against `addr`, or say why not.
    pub fn charge(&self, addr: IpAddr, kind: Kind) -> Result<(), Refused> {
        let mut g = self.lock();
        let cfg = &self.cfg;
        let now = Instant::now();
        if g.banned(addr, now) {
            return Err(Refused::Banned);
        }
        let a = g
            .addr(addr, cfg.max_tracked_addrs, now)
            .ok_or(Refused::Busy)?;
        if now.duration_since(a.window) >= MINUTE {
            a.window = now;
            a.registrations = 0;
            a.joins = 0;
            a.lookups = 0;
        }
        let (n, most, what) = match kind {
            Kind::Registration => (
                &mut a.registrations,
                cfg.registrations_per_minute,
                "registrations a minute",
            ),
            Kind::Join => (&mut a.joins, cfg.joins_per_minute, "joins a minute"),
            Kind::Lookup => (&mut a.lookups, cfg.lookups_per_minute, "lookups a minute"),
        };
        if *n >= most {
            return Err(Refused::Limit(what));
        }
        *n += 1;
        Ok(())
    }

    /// Take a host slot for `addr`: counted until the guard drops.
    pub fn slot(self: &Arc<Self>, addr: IpAddr) -> Result<SlotGuard, Refused> {
        let mut g = self.lock();
        if g.slots >= self.cfg.max_lobbies {
            return Err(Refused::Busy);
        }
        let most = self.cfg.max_lobbies_per_addr;
        let a = g
            .addr(addr, self.cfg.max_tracked_addrs, Instant::now())
            .ok_or(Refused::Busy)?;
        if a.slots >= most {
            return Err(Refused::Limit("lobbies from one address"));
        }
        a.slots += 1;
        let group = group_of(addr);
        if let Some(k) = group {
            let gr = g.groups.entry(k).or_default();
            if gr.slots >= self.cfg.max_lobbies_per_48 {
                g.release_slot(addr);
                return Err(Refused::Limit("lobbies from one IPv6 /48"));
            }
            gr.slots += 1;
        }
        g.slots += 1;
        Ok(SlotGuard {
            state: self.clone(),
            addr,
        })
    }

    /// Admit a TCP connection from `peer`, or None to drop it.
    pub fn connection(self: &Arc<Self>, peer: IpAddr) -> Option<ConnGuard> {
        let mut g = self.lock();
        if g.conns >= self.cfg.max_connections {
            return None;
        }
        let per_addr = self.cfg.behind_proxy.is_none();
        let key = text::addr_key(peer);
        if per_addr {
            let most = self.cfg.max_connections_per_addr;
            let a = g.addr(key, self.cfg.max_tracked_addrs, Instant::now())?;
            if a.conns >= most {
                return None;
            }
            a.conns += 1;
            if let Some(k) = group_of(key) {
                let gr = g.groups.entry(k).or_default();
                if gr.conns >= self.cfg.max_connections_per_48 {
                    if let Some(a) = g.addrs.get_mut(&key) {
                        a.conns -= 1;
                    }
                    return None;
                }
                gr.conns += 1;
            }
        }
        g.conns += 1;
        Some(ConnGuard {
            state: self.clone(),
            addr: per_addr.then_some(key),
        })
    }

    /// Forget addresses with nothing open and a window long past, and bans past their time.
    pub fn sweep(&self) {
        let mut g = self.lock();
        let now = Instant::now();
        g.addrs
            .retain(|_, a| a.slots > 0 || a.conns > 0 || now.duration_since(a.window) < MINUTE);
        g.bans.retain(|_, until| *until > now);
        g.stun
            .retain(|_, (window, _)| now.duration_since(*window) < MINUTE);
    }

    /// Whether to answer one STUN request from `addr` (false: over its minute's
    /// share, or too many addresses in the table at once).
    pub fn stun(&self, addr: IpAddr) -> bool {
        let mut g = self.lock();
        let now = Instant::now();
        if g.banned(addr, now) {
            return false;
        }
        if !g.stun.contains_key(&addr) && g.stun.len() >= self.cfg.max_tracked_addrs {
            g.stun
                .retain(|_, (window, _)| now.duration_since(*window) < MINUTE);
            if g.stun.len() >= self.cfg.max_tracked_addrs {
                return false;
            }
        }
        let (window, n) = g.stun.entry(addr).or_insert((now, 0));
        if now.duration_since(*window) >= MINUTE {
            (*window, *n) = (now, 0);
        }
        if *n >= self.cfg.stun_per_minute {
            return false;
        }
        *n += 1;
        true
    }
}

impl Inner {
    fn addr(&mut self, key: IpAddr, most: usize, now: Instant) -> Option<&mut Addr> {
        if !self.addrs.contains_key(&key) && self.addrs.len() >= most {
            return None;
        }
        Some(self.addrs.entry(key).or_insert(Addr {
            slots: 0,
            conns: 0,
            window: now,
            registrations: 0,
            joins: 0,
            lookups: 0,
        }))
    }

    fn release_slot(&mut self, addr: IpAddr) {
        if let Some(a) = self.addrs.get_mut(&addr) {
            a.slots -= 1;
        }
    }

    fn forget_group(&mut self, k: [u16; 3]) {
        if self
            .groups
            .get(&k)
            .is_some_and(|g| g.slots == 0 && g.conns == 0)
        {
            self.groups.remove(&k);
        }
    }

    pub fn banned(&self, addr: IpAddr, now: Instant) -> bool {
        self.bans.get(&addr).is_some_and(|until| *until > now)
    }

    /// A lobby by id or code, as a page may see it: an id finds listed lobbies
    /// only, a code finds its own lobby whether listed or not.
    pub fn find(&self, key: &str) -> Option<&str> {
        if key.len() == text::CODE_LEN {
            return self.codes.get(key).map(String::as_str);
        }
        self.lobbies
            .get(key)
            .filter(|l| l.listed)
            .map(|l| l.rec.id.as_str())
    }

    /// A lobby by id or code, listed or not (the operator's view).
    pub fn find_any(&self, key: &str) -> Option<String> {
        if key.len() == text::CODE_LEN {
            return self.codes.get(key).cloned();
        }
        self.lobbies.contains_key(key).then(|| key.to_string())
    }

    pub fn remove(&mut self, id: &str) -> Option<Lobby> {
        let l = self.lobbies.remove(id)?;
        self.codes.remove(&l.code);
        Some(l)
    }

    /// A fresh id and code, each unused.
    pub fn fresh(&self) -> (String, String) {
        loop {
            let id = text::random(text::ID_LEN);
            let code = text::random(text::CODE_LEN);
            if !self.lobbies.contains_key(&id) && !self.codes.contains_key(&code) {
                return (id, code);
            }
        }
    }
}

pub struct SlotGuard {
    state: Shared,
    pub addr: IpAddr,
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        let mut g = self.state.lock();
        g.slots -= 1;
        g.release_slot(self.addr);
        if let Some(k) = group_of(self.addr) {
            if let Some(gr) = g.groups.get_mut(&k) {
                gr.slots -= 1;
            }
            g.forget_group(k);
        }
    }
}

pub struct ConnGuard {
    state: Shared,
    addr: Option<IpAddr>,
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        let mut g = self.state.lock();
        g.conns -= 1;
        let Some(key) = self.addr else { return };
        if let Some(a) = g.addrs.get_mut(&key) {
            a.conns -= 1;
        }
        if let Some(k) = group_of(key) {
            if let Some(gr) = g.groups.get_mut(&k) {
                gr.conns -= 1;
            }
            g.forget_group(k);
        }
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

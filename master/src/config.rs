//! Flags. Every limit has one here, with the default the master runs with.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "village-master",
    version,
    about = "Lists Village lobbies and passes one WebRTC offer and one answer for each join. It never carries game traffic and keeps nothing on disk."
)]
pub struct Config {
    /// Address to listen on (plain HTTP; put a proxy that ends TLS in front).
    #[arg(long, default_value = "127.0.0.1:8790")]
    pub listen: SocketAddr,

    /// Take the caller's address from this header (for example x-forwarded-for or
    /// cf-connecting-ip), rightmost value of its last instance. Without it the header
    /// is ignored and the socket's peer is the caller.
    #[arg(long, value_name = "HEADER")]
    pub behind_proxy: Option<String>,

    /// Peers allowed to supply the caller header. Repeat to trust several networks.
    #[arg(long = "trusted-proxy", value_name = "IP-OR-CIDR", value_parser = proxy_network)]
    pub trusted_proxy: Vec<ipnet::IpNet>,

    /// A STUN server for GET /ice, as an RTCIceServer url (stun:host:port). Repeatable.
    #[arg(long = "stun", value_name = "URL")]
    pub stun: Vec<String>,

    /// Answer STUN binding requests on this UDP port, so no third party sees a
    /// player's address. Add its public url with --stun.
    #[arg(long, value_name = "PORT")]
    pub stun_port: Option<u16>,
    /// The address the STUN port is bound on (default: --listen's). STUN is UDP and
    /// cannot pass through an HTTP proxy, so behind one this must be reachable itself.
    #[arg(long, value_name = "IP")]
    pub stun_ip: Option<std::net::IpAddr>,
    /// STUN requests a minute answered for one address (STUN keeps its own table
    /// of at most --max-tracked-addrs addresses).
    #[arg(long, default_value_t = 300)]
    pub stun_per_minute: u32,

    /// File holding the operator's token; enables DELETE /lobbies/<id> and POST /bans.
    #[arg(long, value_name = "PATH")]
    pub admin_token_file: Option<PathBuf>,

    /// Lobbies at once, in all (sockets waiting for their hello count).
    #[arg(long, default_value_t = 2000)]
    pub max_lobbies: usize,
    /// Lobbies at once from one address.
    #[arg(long, default_value_t = 4)]
    pub max_lobbies_per_addr: u32,
    /// Lobbies at once from one IPv6 /48 (one address is a /64 there).
    #[arg(long, default_value_t = 16)]
    pub max_lobbies_per_48: u32,
    /// Host sockets opened a minute by one address.
    #[arg(long, default_value_t = 10)]
    pub registrations_per_minute: u32,
    /// Joins a minute by one address.
    #[arg(long, default_value_t = 30)]
    pub joins_per_minute: u32,
    /// Lookups (GET /, /ice, /lobbies and /lobbies/<id or code>) a minute by one address.
    #[arg(long, default_value_t = 120)]
    pub lookups_per_minute: u32,
    /// Messages a second a host may send (pings included) before its socket is closed.
    #[arg(long, default_value_t = 50)]
    pub host_messages_per_second: u32,
    /// Joins waiting on one host at once.
    #[arg(long, default_value_t = 8)]
    pub max_pending_joins: usize,
    /// Open TCP connections in all.
    #[arg(long, default_value_t = 4096)]
    pub max_connections: usize,
    /// Open TCP connections from one peer (trusted proxies exempt).
    #[arg(long, default_value_t = 8)]
    pub max_connections_per_addr: u32,
    /// Open TCP connections from one IPv6 /48 (trusted proxies exempt).
    #[arg(long, default_value_t = 64)]
    pub max_connections_per_48: u32,
    /// Addresses tracked for limits at once; a new address past this is refused.
    #[arg(long, default_value_t = 100_000)]
    pub max_tracked_addrs: usize,
    /// Bans held at once.
    #[arg(long, default_value_t = 10_000)]
    pub max_bans: usize,

    /// Lobbies in one page of GET /lobbies, and the most `?limit=` may ask for.
    #[arg(long, default_value_t = 200)]
    pub page_size: usize,
    /// Bytes in one SDP (offer or answer).
    #[arg(long, default_value_t = 16 * 1024)]
    pub max_sdp: usize,
    /// Characters in a lobby's name, after cleaning.
    #[arg(long, default_value_t = 48)]
    pub max_name: usize,
    /// Characters in a lobby's about, after cleaning.
    #[arg(long, default_value_t = 200)]
    pub max_about: usize,
    /// Most players a lobby may say it takes.
    #[arg(long, default_value_t = 1000)]
    pub max_most: u32,

    /// Seconds a join waits for the host's answer.
    #[arg(long, default_value_t = 10.0)]
    pub join_wait: f64,
    /// Seconds a lobby may stay silent before it is gone.
    #[arg(long, default_value_t = 60.0)]
    pub silence: f64,
    /// Seconds a new host socket has to send its hello.
    #[arg(long, default_value_t = 10.0)]
    pub hello_wait: f64,
    /// Seconds a write to a host may take before the socket is dropped.
    #[arg(long, default_value_t = 5.0)]
    pub host_write: f64,
    /// Seconds a client has to send a request's headers.
    #[arg(long, default_value_t = 10.0)]
    pub header_read: f64,
    /// Seconds a write to any client may make no progress before its connection is dropped.
    #[arg(long, default_value_t = 10.0)]
    pub write_stall: f64,
    /// Seconds a request may take in all (a join's wait included).
    #[arg(long, default_value_t = 15.0)]
    pub request: f64,
}

fn proxy_network(raw: &str) -> Result<ipnet::IpNet, String> {
    raw.parse()
        .or_else(|_| raw.parse::<std::net::IpAddr>().map(ipnet::IpNet::from))
        .map_err(|_| "expected an IP address or CIDR".into())
}

impl Config {
    pub fn trusts_proxy(&self, ip: std::net::IpAddr) -> bool {
        let ip = ip.to_canonical();
        self.behind_proxy.is_some()
            && if self.trusted_proxy.is_empty() {
                ip.is_loopback()
            } else {
                self.trusted_proxy.iter().any(|n| n.contains(&ip))
            }
    }
}

impl Default for Config {
    fn default() -> Self {
        Config::parse_from(["village-master"])
    }
}

pub fn secs(s: f64) -> Duration {
    Duration::from_secs_f64(s.max(0.0))
}

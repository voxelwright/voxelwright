use std::fs;
use std::process::ExitCode;

use clap::Parser;
use village_master::config::Config;
use village_master::state::State;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let cfg = Config::parse();
    let token = match &cfg.admin_token_file {
        None => None,
        Some(p) => match fs::read_to_string(p) {
            Ok(t) if t.trim().len() >= 16 => Some(t.trim().to_string()),
            Ok(_) => {
                eprintln!("the admin token in {} is under 16 characters", p.display());
                return ExitCode::FAILURE;
            }
            Err(e) => {
                eprintln!("cannot read {}: {e}", p.display());
                return ExitCode::FAILURE;
            }
        },
    };
    let listener = match tokio::net::TcpListener::bind(cfg.listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cannot listen on {}: {e}", cfg.listen);
            return ExitCode::FAILURE;
        }
    };
    eprintln!(
        "village-master {} on http://{}",
        env!("CARGO_PKG_VERSION"),
        cfg.listen
    );
    if cfg.stun.is_empty() {
        eprintln!(
            "no --stun given: GET /ice answers an empty list, so players find each other only on one network"
        );
    }
    match &cfg.behind_proxy {
        Some(h) => eprintln!("trusted proxies name callers with the {h} header"),
        None => eprintln!(
            "callers are named by their socket's peer address (behind a proxy, add --behind-proxy)"
        ),
    }
    if token.is_some() {
        eprintln!("operator routes on: DELETE /lobbies/<id>, POST /bans");
    }
    let st = State::new(cfg, token);
    if let Some(port) = st.cfg.stun_port {
        let ip = st.cfg.stun_ip.unwrap_or(st.cfg.listen.ip());
        match tokio::net::UdpSocket::bind((ip, port)).await {
            Ok(sock) => {
                eprintln!("answering STUN binding requests on udp {ip}:{port}");
                tokio::spawn(village_master::stun::serve(sock, st.clone()));
            }
            Err(e) => {
                eprintln!("cannot listen for STUN on udp {ip}:{port}: {e}");
                return ExitCode::FAILURE;
            }
        }
    }
    tokio::select! {
        _ = village_master::serve(listener, st) => {}
        _ = tokio::signal::ctrl_c() => eprintln!("stopping"),
    }
    ExitCode::SUCCESS
}

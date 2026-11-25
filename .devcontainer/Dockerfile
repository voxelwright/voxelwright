FROM node:25-bookworm-slim AS node
FROM rust:1-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN rustup target add wasm32-unknown-unknown \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

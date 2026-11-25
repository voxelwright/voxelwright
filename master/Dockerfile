# A static (musl) village-master on an empty image. Build: docker build -t village-master master
FROM rust:1.96-alpine AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
RUN cargo build --release --locked

FROM scratch
COPY --from=build /src/target/release/village-master /village-master
USER 65534:65534
EXPOSE 8790
# Inside a container the port must be bound on all interfaces; put the proxy that
# ends TLS in front and pass --behind-proxy <header> after the image name.
ENTRYPOINT ["/village-master", "--listen", "0.0.0.0:8790"]

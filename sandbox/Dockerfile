ARG RUNTIME_IMAGE=debian:bookworm-slim

# ---- 构建阶段：编译 sandbox-web 与 sandbox-cli ----
FROM rust:1-bookworm AS builder
WORKDIR /src
# 先拷贝清单以利用 Docker 层缓存（依赖不变就不重编）
COPY Cargo.toml ./
COPY crates/sandbox-core/Cargo.toml crates/sandbox-core/Cargo.toml
COPY crates/sandbox-web/Cargo.toml crates/sandbox-web/Cargo.toml
# 占位源码，先把依赖编出来
RUN mkdir -p crates/sandbox-core/src crates/sandbox-core/examples crates/sandbox-web/src \
 && echo "fn main(){}" > crates/sandbox-web/src/main.rs \
 && echo "" > crates/sandbox-core/src/lib.rs \
 && echo "fn main(){}" > crates/sandbox-core/examples/cli.rs \
 && cargo build --release --workspace --examples || true
# 拷贝真实源码再正式构建
COPY crates crates
RUN touch crates/sandbox-core/src/lib.rs crates/sandbox-web/src/main.rs \
 && cargo build --release -p sandbox-web \
 && cargo build --release -p sandbox-core --example cli

# ---- 运行阶段 ----
FROM ${RUNTIME_IMAGE}
ARG INSTALL_RUNTIME_PACKAGES=1
RUN if [ "$INSTALL_RUNTIME_PACKAGES" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends gcc g++ python3 libc6-dev ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    fi \
 && ln -sf /usr/bin/g++ /usr/bin/g++-9 \
 && ln -sf /usr/bin/gcc /usr/bin/gcc-9 \
 && test -x /usr/bin/python3
COPY --from=builder /src/target/release/sandbox-web /usr/local/bin/sandbox-web
COPY --from=builder /src/target/release/examples/cli /usr/local/bin/sandbox-cli
COPY frontend /app/frontend
ENV FRONTEND_DIR=/app/frontend \
    SANDBOX_CLI=sandbox-cli \
    JOBS_ROOT=/tmp/sandbox-jobs \
    BIND=0.0.0.0:1145 \
    RUST_LOG=info
EXPOSE 1145
CMD ["sandbox-web"]

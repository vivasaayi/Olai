FROM node:22-bookworm-slim AS frontend
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM rust:1-bookworm AS backend
WORKDIR /build/server
COPY server/ ./
ARG BUILD_COMMIT=development
ENV OLAI_BUILD_COMMIT=$BUILD_COMMIT
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/server/target cargo build --release --locked && cp target/release/olai-server /olai-server

FROM debian:bookworm-slim
RUN mkdir /data && chown 10001:10001 /data
COPY --from=backend /olai-server /usr/local/bin/olai-server
COPY --from=frontend /build/web/dist /app/web
ENV OLAI_BIND=0.0.0.0:8080 OLAI_DATA_DIR=/data OLAI_WEB_DIR=/app/web
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["olai-server"]

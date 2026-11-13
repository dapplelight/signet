# Runs the API under Bun (src/server.ts), not as a Worker.
#   docker build -t __APP_NAME__ .
#   docker run -p 3000:3000 __APP_NAME__
FROM oven/bun:1
WORKDIR /app
# Commit bun.lock: --frozen-lockfile fails the build if it is missing or stale.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENV APP_ENV=production PORT=3000
EXPOSE 3000
USER bun
CMD ["bun", "src/server.ts"]

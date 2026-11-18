# Runs the API under Deno (src/server.ts), not as a Worker.
#   docker build -t __APP_NAME__ .
#   docker run -p 3000:3000 __APP_NAME__
FROM denoland/deno:2
WORKDIR /app
COPY package.json ./
RUN deno install --prod
COPY src ./src
ENV APP_ENV=production PORT=3000
EXPOSE 3000
USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-sys", "src/server.ts"]

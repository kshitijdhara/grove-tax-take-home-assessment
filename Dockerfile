FROM oven/bun:1.2 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
EXPOSE 3100

CMD ["bun", "run", "start"]

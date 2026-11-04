# GOLD INTELLIGENCE AI — frontend + backend (Next.js 16)
FROM oven/bun:1 AS base
WORKDIR /app

# dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# build
COPY . .
RUN bun run build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "run", "start"]

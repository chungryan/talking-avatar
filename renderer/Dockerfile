# syntax=docker/dockerfile:1.6

FROM --platform=linux/amd64 node:20-bullseye-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python3-distutils python-is-python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM --platform=linux/amd64 node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
EXPOSE 8080
CMD ["node", "dist/server.js"]

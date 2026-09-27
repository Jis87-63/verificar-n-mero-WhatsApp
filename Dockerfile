FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Chromium and its shared libraries are required by whatsapp-web.js/Puppeteer.
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]

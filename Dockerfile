FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs database.mjs community.mjs operations.mjs push.mjs ./
COPY campora/*.html campora/*.js campora/*.css campora/favicon.png ./campora/
COPY campora/manifest.webmanifest ./campora/
ENV CAMPORA_HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.mjs"]

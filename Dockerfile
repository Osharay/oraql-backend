# ─── Build Stage ───
FROM node:20-alpine AS builder

# Prisma engines need OpenSSL on Alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ─── Production Stage ───
FROM node:20-alpine AS production

# Prisma engines need OpenSSL on Alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + engines, needed to run migrations at startup
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 4000

# Default: run the API server. Override CMD for worker.
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && node dist/main"]

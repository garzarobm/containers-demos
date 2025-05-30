FROM node:18-alpine AS builder
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm
WORKDIR /usr/src/app
COPY host/package.json host/pnpm-lock.yaml ./
RUN pnpm install
COPY host/server.js ./

FROM node:18-alpine AS runtime
RUN npm install -g pnpm
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY host/package.json host/pnpm-lock.yaml ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/server.js ./
EXPOSE 8080
USER node
CMD [ "node", "server.js" ]

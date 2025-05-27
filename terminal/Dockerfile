FROM node:18-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /usr/src/app
COPY host/package.json ./
COPY host/package-lock.json* ./
RUN npm install
COPY host/server.js ./

FROM node:18-alpine AS runtime
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY host/package.json ./
COPY host/package-lock.json* ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/server.js ./
EXPOSE 8080
USER node
CMD [ "node", "server.js" ]

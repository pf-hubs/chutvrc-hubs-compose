FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN chmod +x dist/cli.js || true
ENV NODE_ENV=production
EXPOSE 9099
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]

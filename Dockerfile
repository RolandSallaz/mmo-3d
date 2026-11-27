FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
USER node
EXPOSE 2567
CMD ["npm", "run", "server"]

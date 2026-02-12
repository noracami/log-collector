FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ARG COMMIT_SHA=unknown
RUN echo "$COMMIT_SHA" > .commit
EXPOSE 3000
CMD ["node", "index.js"]

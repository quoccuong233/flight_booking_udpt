FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production SERVICE_NAME=${SERVICE}
WORKDIR /app
COPY . .
RUN npm ci --omit=dev -w common -w ${SERVICE}
USER node
EXPOSE 3000
# `exec` makes node PID 1 so it receives SIGTERM directly.
CMD ["sh", "-c", "exec node ${SERVICE_NAME}/src/index.js"]

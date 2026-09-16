FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json ./
RUN npm install
COPY backend/tsconfig*.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY supabase/migrations ./supabase/migrations
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]

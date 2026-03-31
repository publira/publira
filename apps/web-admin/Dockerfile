## Next.js 本番運用用 Dockerfile（ホストでビルド済み成果物のみを含める）
FROM gcr.io/distroless/nodejs24-debian12 AS runner
WORKDIR /app
ENV NODE_ENV=production
	ENV PORT=4000
COPY .next/standalone ./.next/standalone
COPY .next/static ./.next/static
# COPY public ./public
COPY package.json ./package.json
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/ || exit 1
EXPOSE $PORT
CMD [".next/standalone/server.js"]

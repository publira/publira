## Next.js 本番運用用 Dockerfile（ホストでビルド済み成果物のみを含める）
FROM gcr.io/distroless/nodejs24-debian12@sha256:61f4f4341db81820c24ce771b83d202eb6452076f58628cd536cc7d94a10978b AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY .next/standalone ./.next/standalone
COPY .next/static ./.next/static
COPY public ./public
COPY package.json ./package.json
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://localhost:$PORT/ || exit 1
EXPOSE $PORT
CMD [".next/standalone/server.js"]

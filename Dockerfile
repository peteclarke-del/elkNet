FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node storage ./storage
COPY --chown=node:node tools ./tools

RUN npm run build:content

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server/server.mjs"]

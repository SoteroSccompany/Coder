# Studio Server (DESENVOLVIMENTO). Em dev o codigo vem por volume (./studio/server:/app).
FROM node:20-slim

ENV TZ=America/Sao_Paulo
WORKDIR /app

# Dependencias primeiro (cache de camada); node_modules fica no volume anonimo do compose
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# Porta padrao do server (STUDIO_SERVER_PORT)
EXPOSE 7900

# Reinicia ao editar o codigo (Node 20: --watch). Em volumes Docker de macOS/Windows use
# STUDIO_WATCH_POLLING=true para o watcher de PROJETOS enxergar mudancas.
CMD ["node", "--watch", "src/index.js"]

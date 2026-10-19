# Studio UI (DESENVOLVIMENTO): Vite dev server com HMR. Codigo via volume (./studio/ui:/app).
FROM node:20-slim

ENV TZ=America/Sao_Paulo
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# Porta do Vite (STUDIO_UI_PORT, padrao 5173)
EXPOSE 5173

# O proxy de /api e /ws aponta para STUDIO_SERVER_URL (ex.: http://studioserver:7900)
CMD ["npm", "run", "dev"]

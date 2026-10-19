FROM node:20-slim

ENV TZ=America/Sao_Paulo

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE {{port}}

CMD ["node", "index.js"]

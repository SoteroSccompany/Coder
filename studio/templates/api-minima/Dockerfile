FROM node:20-slim

RUN npm install -g nodemon

ENV TZ=America/Sao_Paulo

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE {{port}}

CMD ["nodemon", "index.js"]

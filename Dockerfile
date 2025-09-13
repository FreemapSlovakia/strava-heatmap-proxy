FROM node:18

WORKDIR /app

COPY . .

RUN npm install
RUN npm run compile

EXPOSE 8080

CMD ["node", "dist/index.js"]
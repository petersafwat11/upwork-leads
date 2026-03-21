FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production --ignore-scripts

COPY . .

RUN mkdir -p data output

EXPOSE 3000

ENV NODE_ENV=production
ENV FETCH_METHOD=flaresolverr

CMD ["node", "index.js"]

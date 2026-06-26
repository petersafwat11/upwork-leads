FROM node:20-alpine

# tzdata so named timezones (TZ=Africa/Cairo) resolve — Alpine ships without it,
# which would otherwise silently fall back to UTC for the daily-report cron.
RUN apk add --no-cache tzdata

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production --ignore-scripts

COPY . .

RUN mkdir -p data output

EXPOSE 3000

ENV NODE_ENV=production
ENV FETCH_METHOD=flaresolverr
# Server-local time = Cairo, so the daily-report cron (0 8 * * *) fires at 8 AM
# Cairo with no VPS .env edits. Override via TZ in docker-compose if needed.
ENV TZ=Africa/Cairo

CMD ["node", "index.js"]

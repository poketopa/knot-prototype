FROM node:22-alpine

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache postgresql-client

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/prototype-contracts/package.json packages/prototype-contracts/package.json

RUN corepack pnpm install --filter @meeting-stt/api... --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY packages/prototype-contracts packages/prototype-contracts

CMD ["sh", "-c", "corepack pnpm --filter @meeting-stt/api run db:migrate && corepack pnpm --filter @meeting-stt/api run start"]

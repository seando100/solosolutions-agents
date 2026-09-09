FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy everything (source needed for workspace linking)
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Start the orchestrator
CMD ["npx", "tsx", "orchestrator/src/index.ts"]

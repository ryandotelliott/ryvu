# List recipes
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Run the dev server with hot reload; Ctrl-C stops running analyses, then the server
dev:
    pnpm dev

# Build the app, then type-check it
build:
    pnpm run build

# Serve the production build
start: build
    pnpm start

# Type-check all sources
typecheck:
    pnpm run typecheck

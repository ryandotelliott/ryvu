# List recipes
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Run the API server and Vite dev server with reload; Ctrl-C stops both
dev:
    pnpm dev

# Type-check and build the server and browser app
build:
    pnpm run build

# Serve the production build
start: build
    pnpm start

# Type-check server and browser sources
typecheck:
    pnpm run typecheck

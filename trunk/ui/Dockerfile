FROM node:20-alpine AS builder
# Build context is the REPO ROOT (see docker-compose ui.build.context: ..). We
# mirror the repo layout under /repo so the Vite glob picks up module UIs at
# ../../modules and the `../<lib>` / `@trunk` aliases resolve exactly as locally.
WORKDIR /repo/trunk/ui
COPY trunk/ui/package.json .
RUN npm install
# bring in the rest, preserving repo structure (node_modules from the install
# above is untouched — it's gitignored out of the context)
WORKDIR /repo
COPY trunk ./trunk
COPY modules ./modules
# Module UIs live outside trunk/ui, so their bare imports (leaflet, react, …) can't
# walk up to trunk/ui/node_modules. Hoist it to the repo root via a symlink — the
# same thing npm/yarn workspaces do — so every module resolves the one install.
RUN ln -s trunk/ui/node_modules node_modules
WORKDIR /repo/trunk/ui
RUN npm run build

FROM nginx:alpine
COPY --from=builder /repo/trunk/ui/dist /usr/share/nginx/html
COPY trunk/ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

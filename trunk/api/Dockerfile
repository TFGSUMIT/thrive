FROM python:3.12-slim
# Build context is the REPO ROOT (see docker-compose api.build.context: ..) so the
# image can install module backend deps alongside trunk's.
WORKDIR /app
# trunk platform deps
COPY trunk/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# per-module backend deps: install each modules/<name>/requirements.txt present.
# Module CODE is bind-mounted live at runtime (no rebuild to edit a router); only
# deps are baked here, so adding a module's dependency means an API rebuild — the
# same rebuild-on-install model as the UI.
COPY modules /tmp/modules
RUN for r in /tmp/modules/*/requirements.txt; do [ -f "$r" ] && pip install --no-cache-dir -r "$r" || true; done && rm -rf /tmp/modules
# trunk API code
COPY trunk/api .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

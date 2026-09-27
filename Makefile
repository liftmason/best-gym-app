# One command to a working local site:  make dev
PY := .venv/bin/python
-include .env
export

.PHONY: dev install db migrate seed run test lint fmt check

dev: install db migrate seed run

# Python 3.14 and the exact versions in uv.lock (install uv: https://docs.astral.sh/uv/).
install:
	uv sync --locked

db:
	docker compose up -d --wait db storage
	$(PY) manage.py storage_setup

migrate:
	$(PY) manage.py migrate

seed:
	$(PY) manage.py seed_demo

run:
	$(PY) manage.py runserver

test:
	$(PY) -m pytest tests/unit

lint:
	.venv/bin/ruff check .
	.venv/bin/ruff format --check .

fmt:
	.venv/bin/ruff check --fix .
	.venv/bin/ruff format .

check:
	$(PY) manage.py makemigrations --check --dry-run
	DJANGO_SETTINGS_MODULE=config.settings.production ALLOWED_HOSTS=gymtrainer.onrender.com SECRET_KEY=check-only-$$(date +%s)-not-a-real-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
		$(PY) manage.py check --deploy --fail-level WARNING

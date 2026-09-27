# The Django backend lives in backend/ (the Expo app arrives in app/, sub-project 4).
# One command to a working local backend:  make dev
B := cd backend &&
PY := .venv/bin/python
-include backend/.env
export

.PHONY: dev install db migrate seed run test lint fmt check audit

dev: install db migrate seed run

# Python 3.14 and the exact versions in backend/uv.lock (install uv: https://docs.astral.sh/uv/).
install:
	$(B) uv sync --locked

db:
	docker compose up -d --wait db storage
	$(B) $(PY) manage.py storage_setup

migrate:
	$(B) $(PY) manage.py migrate

seed:
	$(B) $(PY) manage.py seed_demo --reset

run:
	$(B) $(PY) manage.py runserver

test:
	$(B) $(PY) -m pytest tests/unit

lint:
	$(B) .venv/bin/ruff check .
	$(B) .venv/bin/ruff format --check .

fmt:
	$(B) .venv/bin/ruff check --fix .
	$(B) .venv/bin/ruff format .

check:
	$(B) $(PY) manage.py makemigrations --check --dry-run
	$(B) DJANGO_SETTINGS_MODULE=config.settings.production ALLOWED_HOSTS=gymtrainer.onrender.com SITE_URL=https://gymtrainer.onrender.com EMAIL_PROVIDER=console SECRET_KEY=check-only-$$(date +%s)-not-a-real-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
		$(PY) manage.py check --deploy --fail-level WARNING

# Known vulnerabilities in the locked dependencies (CI runs this too).
audit:
	$(B) uv export --locked --no-emit-project -o /tmp/gymtrainer-requirements.txt
	$(B) uvx pip-audit -r /tmp/gymtrainer-requirements.txt --disable-pip --require-hashes

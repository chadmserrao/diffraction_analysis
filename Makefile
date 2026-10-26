# Every command runs inside the container, through compose.
# `make` (or `make help`) lists the targets.

COMPOSE_PROJECT_NAME := $(shell basename "$(CURDIR)" | tr 'A-Z' 'a-z')
HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)
export COMPOSE_PROJECT_NAME HOST_UID HOST_GID

COMPOSE := docker compose -f docker/compose.yaml
RUN     := $(COMPOSE) run --rm -T app

.DEFAULT_GOAL := help
.PHONY: help build up down verify test check lint smoke dist lab-test shell clean

##@ Everyday

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  %-9s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the image (Python and Node, nothing else)
	$(COMPOSE) build app

up: build ## Start the app at http://127.0.0.1:8765/ (stop it with make down)
	$(COMPOSE) up -d --wait annotator
	@echo "Diffraction Annotator at http://127.0.0.1:8765/  (sample patterns: samples/)"

down: ## Stop the app
	$(COMPOSE) down --remove-orphans

verify: build lint check test smoke ## The gate: lint, checks, sample tests and a smoke test

##@ While developing

lint: ## Syntax check of every Python and JavaScript file
	$(RUN) sh -c 'python -c "import ast, sys; [ast.parse(open(f).read(), f) for f in sys.argv[1:]]" *.py tools/*.py && for f in src/*.js tests/*.js tools/*.js; do node --check "$$f" || exit 1; done'

check: ## Checks that need no images: crystal maths and the phase library
	$(RUN) node tests/check_crystal.js

test: ## Centre, scale bar and determinism on the patterns in samples/
	$(RUN) node tests/regression.js tests/sample_cases.json

smoke: ## Start the app, check that the page and a sample are served, stop it
	$(COMPOSE) up -d --wait annotator
	$(COMPOSE) exec -T annotator python -c "import urllib.request as u; p = u.urlopen('http://127.0.0.1:8765/').read(); assert b'<title>' in p and len(p) > 1e6, 'page'; s = u.urlopen('http://127.0.0.1:8765/files/250704_0030.tif').read(); assert s[:2] in (b'II', b'MM'), 'sample'; print('Smoke test passed: page', round(len(p) / 1e6, 1), 'MB, sample', round(len(s) / 1e6, 1), 'MB')"; status=$$?; $(COMPOSE) down --remove-orphans; exit $$status

dist: ## Rebuild dist/diffraction_annotator.html from src/
	$(RUN) python build.py

lab-test: ## The 16 regression cases on the lab's own data/ folder (not in this repository)
	$(RUN) node tests/regression.js

shell: ## Open a shell in the container, project folder at /work
	$(COMPOSE) run --rm app bash

clean: ## Remove this project's containers and image (samples and results are untouched)
	$(COMPOSE) down --rmi local --remove-orphans

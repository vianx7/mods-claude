#!/bin/bash
# Instalador do MacBook Checker. No terminal do Mac:
#   curl -fsSL https://raw.githubusercontent.com/vianx7/mods-claude/main/macbook-checker/install.sh | bash
set -e
BASE="${MBC_BASE:-https://raw.githubusercontent.com/vianx7/mods-claude/claude/intelligent-albattani-26396s/macbook-checker}"
DIR="${TMPDIR:-/tmp}/macbook-checker"

mkdir -p "$DIR"
echo "⬇️  Baixando o MacBook Checker..."
curl -fsSL "$BASE/index.html" -o "$DIR/index.html"
curl -fsSL "$BASE/check.sh"   -o "$DIR/check.sh"
curl -fsSL "$BASE/server.pl"  -o "$DIR/server.pl"
chmod +x "$DIR/check.sh"

# </dev/tty: quando vem de "curl | bash", o stdin é o próprio script
exec bash "$DIR/check.sh" </dev/tty

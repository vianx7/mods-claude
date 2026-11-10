#!/bin/bash
# MacBook Checker — lê o hardware deste Mac e abre a página de testes.
# Uso: bash check.sh   (rode na pasta onde estão index.html e check.sh)

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${MBC_PORT:-8765}"

if [ "$(uname)" != "Darwin" ]; then
  echo "⚠️  Isto não é um Mac. Vou abrir só a página de testes, sem os dados de hardware."
fi

echo "🔎 Lendo informações do sistema (leva uns segundos)..."

# Texto qualquer -> string JSON
json_str() {
  local s
  s="$(printf '%s' "$1" | tr '\t\r' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}')"
  printf '"%s"' "$s"
}

SP="null"
if command -v system_profiler >/dev/null 2>&1; then
  SP="$(system_profiler -json SPHardwareDataType SPSoftwareDataType SPPowerDataType SPStorageDataType SPNVMeDataType SPDisplaysDataType SPCameraDataType SPAudioDataType SPBluetoothDataType SPAirPortDataType 2>/dev/null)"
  # macOS anterior ao 10.15 não tem -json: aí fica sem os dados
  case "$(printf '%s' "$SP" | tr -d ' \n' | cut -c1)" in "{") ;; *) SP="null" ;; esac
fi

MDM=""
command -v profiles >/dev/null 2>&1 && MDM="$(profiles status -type enrollment 2>/dev/null)"

BATT_IOREG=""
command -v ioreg >/dev/null 2>&1 && BATT_IOREG="$(ioreg -r -c AppleSmartBattery 2>/dev/null | grep -E '"(DesignCapacity|AppleRawMaxCapacity|MaxCapacity|CycleCount|DesignCycleCount9C)" =' | sed 's/^[[:space:]]*//')"

SMART=""
command -v diskutil >/dev/null 2>&1 && SMART="$(diskutil info disk0 2>/dev/null | grep -i 'SMART' | sed 's/^[[:space:]]*//')"

UPTIME="$(uptime 2>/dev/null)"

{
  echo "window.SYSINFO = {"
  echo "  \"generatedAt\": $(json_str "$(date '+%d/%m/%Y %H:%M')"),"
  echo "  \"mdm\": $(json_str "$MDM"),"
  echo "  \"batteryIoreg\": $(json_str "$BATT_IOREG"),"
  echo "  \"smartDiskutil\": $(json_str "$SMART"),"
  echo "  \"uptime\": $(json_str "$UPTIME"),"
  echo "  \"sp\": $SP"
  echo "};"
} > "$DIR/info.js"

echo "✅ Informações salvas."

URL=""
SERVER_PID=""
# Um servidor local (http://127.0.0.1) libera câmera e microfone em qualquer navegador.
# O python3 de /usr/bin só funciona se as Command Line Tools estiverem instaladas
# (senão o macOS abre um pop-up pedindo para instalar) — por isso a checagem.
PY=""
if command -v python3 >/dev/null 2>&1; then
  if [ "$(command -v python3)" != "/usr/bin/python3" ] || xcode-select -p >/dev/null 2>&1; then
    PY="python3"
  fi
fi

if [ -n "$PY" ]; then
  "$PY" -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    URL="http://127.0.0.1:$PORT/index.html"
  else
    SERVER_PID=""
  fi
fi

open_url() {
  if [ "$(uname)" = "Darwin" ]; then
    # Chrome lida melhor com câmera/microfone quando a página é aberta como arquivo
    if [ -z "$SERVER_PID" ] && [ -d "/Applications/Google Chrome.app" ]; then
      open -a "Google Chrome" "$1"
    else
      open "$1"
    fi
  else
    xdg-open "$1" >/dev/null 2>&1 || echo "Abra no navegador: $1"
  fi
}

if [ -n "$URL" ]; then
  echo "🌐 Abrindo $URL"
  open_url "$URL"
  echo ""
  echo "Deixe este terminal aberto enquanto faz os testes."
  echo "Quando terminar, aperte Ctrl+C aqui para fechar."
  trap 'kill "$SERVER_PID" 2>/dev/null; echo; echo "👋 Pronto. Até mais!"; exit 0' INT TERM
  wait "$SERVER_PID"
else
  echo "🌐 Abrindo a página como arquivo local."
  echo "   (Se câmera/microfone não funcionarem no Safari, abra no Chrome: $DIR/index.html)"
  open_url "$DIR/index.html"
fi

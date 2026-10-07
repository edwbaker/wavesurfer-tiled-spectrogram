#!/usr/bin/env bash
# Makes the demo's sample recording and its tiles in demo/samples/: 70 s at
# 44.1 kHz of a 5 kHz tone, loud then quiet, then noise. Needs ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p demo/samples
ffmpeg -v error -nostdin -y -f lavfi \
  -i "aevalsrc=if(lt(t\,10)\,0.1*sin(2*PI*5000*t)\,if(lt(t\,20)\,0.01*sin(2*PI*5000*t)\,0.05*(2*random(0)-1))):s=44100:d=70" \
  -c:a pcm_s16le demo/samples/demo.wav
bash tools/make-tiles.sh demo/samples/demo.wav demo/samples/demo

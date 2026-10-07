#!/usr/bin/env bash
# Makes a tiled spectrogram of an audio file with ffmpeg: greyscale JPEG tiles
# and the index.json that describes them (see SPEC.md).
#
#   make-tiles.sh [options] INPUT OUTDIR
#
#   --tile-seconds S   seconds a tile covers, near enough (60)
#   --pps N            columns a second, near enough (86)
#   --height H         rows; the FFT is 2*H points (256, a 512-point FFT)
#   --channel C        the channel shown, counting from 0 (0)
#   --gain-db G        levels as wavesurfer.js's Spectrogram plugin's gainDB:
#                      -G dB and above is black (20, the plugin's default)
#   --range-db R       and as its rangeDB: dB from black down to white (80)
#   --quality Q        JPEG quality, ffmpeg's -q:v: 2 is best, 31 worst (12)
#   --calibration C    a name for these settings, kept in the manifest
#
# The Spectrogram plugin looks like the tiles with the same gainDB and rangeDB,
# scale 'linear', colorMap 'gray', and fftSamples twice the height.
#
# Every column is a whole number of samples, chosen near the rate asked for so
# that ffmpeg's showspectrumpic drops none (it would otherwise lose the
# remainder of each column and drift by tens of ms over a tile), and every
# tile is trimmed or padded to exactly its columns' worth of samples. The file
# is first decoded once to a mono WAV of the channel shown, so that each tile
# can be cut from it exactly, whatever the file's format.
set -euo pipefail

tile_seconds=60
pps=86
height=256
channel=0
gain_db=20
range_db=80
quality=12
calibration=""

die() { echo "make-tiles.sh: $*" >&2; exit 1; }

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --tile-seconds) tile_seconds="$2"; shift 2 ;;
    --pps) pps="$2"; shift 2 ;;
    --height) height="$2"; shift 2 ;;
    --channel) channel="$2"; shift 2 ;;
    --gain-db) gain_db="$2"; shift 2 ;;
    --range-db) range_db="$2"; shift 2 ;;
    --quality) quality="$2"; shift 2 ;;
    --calibration) calibration="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -eq 2 ] || die "give an input file and an output directory (--help)"
input="${args[0]}"
outdir="${args[1]}"
[ -f "$input" ] || die "no such file: $input"
command -v ffmpeg >/dev/null || die "ffmpeg is not installed"
command -v ffprobe >/dev/null || die "ffprobe is not installed"

probe() {
  ffprobe -v error -select_streams a:0 -show_entries "stream=$1" -of csv=p=0 "$2" | tr -d '\r' | head -n 1
}

rate=$(probe sample_rate "$input")
channels=$(probe channels "$input")
[ -n "$rate" ] || die "no audio in $input"
[ "$channel" -lt "$channels" ] || die "$input has $channels channels, so there is no channel $channel"

# The levels in ffmpeg's terms: its dynamic range, and the level it shows as
# black. ffmpeg measures a sine 2 dB lower than wavesurfer.js does, as found by
# comparing the two spectrograms of the same recordings.
drange=$range_db
limit=$(awk -v g="$gain_db" 'BEGIN { print 2 - g }')
awk -v d="$drange" -v l="$limit" 'BEGIN { exit !(d >= 10 && d <= 200 && l >= -100 && l <= 100) }' ||
  die "ffmpeg cannot show --range-db $range_db (10 to 200) or --gain-db $gain_db (-98 to 102)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mono="$tmp/mono.wav"
ffmpeg -v error -nostdin -y -i "$input" -map 0:a:0 -af "pan=mono|c0=c${channel}" \
  -c:a pcm_f32le -rf64 auto "$mono"
samples=$(probe duration_ts "$mono")
[ "${samples:-0}" -gt 0 ] || die "no samples decoded from $input"

# Samples a column: the whole number nearest rate/pps that showspectrumpic
# divides into hops of at most 2*height samples with nothing left over
spc=$(awk -v r="$rate" -v p="$pps" -v n="$((2 * height))" 'BEGIN {
  t = r / p; best = 0; bd = 1e18
  for (s = int(t) - 128; s <= int(t) + 128; s++) {
    if (s < 1) continue
    k = int((s + n - 1) / n)
    if (s % k == 0) { d = s - t; if (d < 0) d = -d; if (d < bd) { bd = d; best = s } }
  }
  print best
}')
[ "$spc" -gt 0 ] || die "could not choose the samples a column for $rate Hz"

width=$(awk -v s="$tile_seconds" -v r="$rate" -v c="$spc" 'BEGIN { w = int(s * r / c + 0.5); print (w < 1 ? 1 : w) }')
tile_samples=$((width * spc))
tile_count=$(( (samples + tile_samples - 1) / tile_samples ))

mkdir -p "$outdir"
for ((i = 0; i < tile_count; i++)); do
  first=$((i * tile_samples))
  left=$((samples - first))
  columns=$width
  crop=""
  if [ "$left" -lt "$tile_samples" ]; then
    columns=$(( (left + spc - 1) / spc ))
    crop=",crop=${columns}:${height}:0:0"
  fi
  start=$(awk -v f="$first" -v r="$rate" 'BEGIN { printf "%.9f", f / r }')
  ffmpeg -v error -nostdin -y -ss "$start" -i "$mono" -lavfi \
    "atrim=end_sample=${tile_samples},apad=whole_len=${tile_samples},showspectrumpic=s=${width}x${height}:legend=0:mode=combined:color=channel:scale=log:fscale=lin:win_func=hann:drange=${drange}:limit=${limit},format=gray,negate${crop}" \
    -frames:v 1 -q:v "$quality" "$outdir/$i.jpg"
done

# The manifest is written last, and only once every tile has been
awk -v rate="$rate" -v samples="$samples" -v spc="$spc" -v width="$width" -v height="$height" \
    -v count="$tile_count" -v channel="$channel" -v drange="$drange" -v limit="$limit" \
    -v gain="$gain_db" -v range="$range_db" -v calibration="$calibration" 'BEGIN {
  printf "{\n"
  printf "  \"type\": \"tiled-spectrogram\",\n  \"version\": 1,\n"
  printf "  \"duration\": %.6f,\n", samples / rate
  printf "  \"tileDuration\": %.9f,\n", width * spc / rate
  printf "  \"tileCount\": %d,\n", count
  printf "  \"tiles\": \"{index}.jpg\",\n  \"mimeType\": \"image/jpeg\",\n"
  printf "  \"width\": %d,\n  \"height\": %d,\n", width, height
  printf "  \"pixelsPerSecond\": %.6f,\n", rate / spc
  printf "  \"frequencyMin\": 0,\n  \"frequencyMax\": %s,\n  \"frequencyScale\": \"linear\",\n", rate / 2
  printf "  \"sampleRate\": %d,\n  \"samplesPerColumn\": %d,\n  \"channel\": %d,\n", rate, spc, channel
  printf "  \"fftSize\": %d,\n  \"window\": \"hann\",\n", 2 * height
  printf "  \"colorMap\": \"gray\",\n"
  printf "  \"dbRange\": [%s, %s],\n", -gain - range, -gain
  printf "  \"renderer\": {\"name\": \"ffmpeg showspectrumpic\", \"scale\": \"log\", \"drange\": %s, \"limit\": %s},\n", drange, limit
  printf "  \"calibration\": \"%s\"\n", calibration
  printf "}\n"
}' > "$outdir/index.json"

echo "$outdir: $tile_count tiles of ${width}x${height} at $spc samples a column ($rate Hz)"

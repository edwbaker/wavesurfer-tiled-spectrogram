#!/usr/bin/env bash
# Makes a tiled spectrogram of an audio file with ffmpeg, at several
# resolutions (levels), and the index.json that describes them (see SPEC.md):
# greyscale JPEG tiles in OUTDIR/<samples a column>/, the finest level at about
# --pps columns a second and each coarser one four times coarser, until one
# tile covers the recording. Above 96 kHz the finest level is four times finer
# again, in tiles a quarter as long, unless --pps or --tile-seconds says
# otherwise: a column of 86 a second would there combine three or more FFT
# windows, and lose the timing of short sounds. A coarser level is made from the one below it,
# each pixel keeping the loudest of the four it covers in its row, so that
# short sounds still show. Beside them go the recording's waveform peaks for
# each level, in OUTDIR/peaks-<samples a column>.json, for a player that
# streams the audio rather than decoding it.
#
#   make-tiles.sh [options] INPUT OUTDIR
#
# INPUT can also be a folder. Every audio file in it, and in the folders within
# it, is then tiled into the same path under OUTDIR less its extension:
# INPUT/a/b.wav into OUTDIR/a/b/. Those already tiled are passed over, so a run
# that stops part way can be started again.
#
# OUTDIR must be empty or hold only tiles made before, which are replaced.
# Anything else in it is taken as a sign of a mistake, and refused.
#
#   --tile-seconds S   seconds a tile of the finest level covers, near enough
#                      (60; 15 above 96 kHz)
#   --pps N            columns a second of the finest level, near enough
#                      (86; 344 above 96 kHz)
#   --height H         rows; the FFT is 2*H points (256, a 512-point FFT)
#   --channel C        the channel shown, counting from 0 (0)
#   --gain-db G        loudness as wavesurfer.js's Spectrogram plugin's gainDB:
#                      -G dB and above is black (20, the plugin's default)
#   --range-db R       and as its rangeDB: dB from black down to white (80)
#   --quality Q        JPEG quality, ffmpeg's -q:v: 2 is best, 31 worst (12)
#   --calibration C    a name for these settings, kept in the manifest
#   --no-peaks         no peaks files
#   --jobs J           for a folder: recordings tiled at once (1)
#   --force            for a folder: tile again those already tiled
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
pps_given=0
tile_seconds_given=0
peaks=1
jobs=1
force=0

die() { echo "make-tiles.sh: $*" >&2; exit 1; }

args=()
opts=() # the options that say how to tile, passed on for each file of a folder
while [ $# -gt 0 ]; do
  case "$1" in
    --tile-seconds|--pps|--height|--channel|--gain-db|--range-db|--quality|--calibration)
      [ $# -ge 2 ] || die "$1 needs a value"
      opts+=("$1" "$2")
      case "$1" in
        --tile-seconds) tile_seconds="$2"; tile_seconds_given=1 ;;
        --pps) pps="$2"; pps_given=1 ;;
        --height) height="$2" ;;
        --channel) channel="$2" ;;
        --gain-db) gain_db="$2" ;;
        --range-db) range_db="$2" ;;
        --quality) quality="$2" ;;
        --calibration) calibration="$2" ;;
      esac
      shift 2 ;;
    --no-peaks) peaks=0; opts+=("$1"); shift ;;
    --jobs) [ $# -ge 2 ] || die "--jobs needs a value"; jobs="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) sed -n '2,/fftSamples twice the height/p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -eq 2 ] || die "give an input file or folder, and an output folder (--help)"
input="${args[0]}"
outdir="${args[1]}"
command -v ffmpeg >/dev/null || die "ffmpeg is not installed"
command -v ffprobe >/dev/null || die "ffprobe is not installed"

# A folder: each audio file in it is tiled by this script, --jobs at a time
if [ -d "$input" ]; then
  case "$jobs" in ''|*[!0-9]*|0) die "--jobs must be a whole number, 1 or more" ;; esac
  while [ "$input" != "${input%/}" ] && [ "$input" != / ]; do input=${input%/}; done
  list=$(mktemp -d)
  trap 'rm -rf "$list"' EXIT
  : > "$list/targets"
  : > "$list/todo"
  : > "$list/done"
  found=0
  skipped=0
  # Hidden files and folders (.git, .DS_Store, ._name.wav) are passed over
  while IFS= read -r -d '' file; do
    found=$((found + 1))
    rel=${file#"$input"/}
    target="$outdir/${rel%.*}"
    printf '%s\n' "$target" >> "$list/targets"
    if [ "$force" -eq 0 ] && [ -f "$target/index.json" ]; then
      skipped=$((skipped + 1))
    else
      printf '%s\0%s\0' "$file" "$target" >> "$list/todo"
    fi
  done < <(find "$input" -mindepth 1 -name '.*' -prune -o -type f \( \
    -iname '*.wav' -o -iname '*.wave' -o -iname '*.w64' -o -iname '*.flac' -o -iname '*.wv' \
    -o -iname '*.mp3' -o -iname '*.ogg' -o -iname '*.oga' -o -iname '*.opus' -o -iname '*.m4a' \
    -o -iname '*.aac' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.aifc' -o -iname '*.caf' \
    \) -print0)
  [ "$found" -gt 0 ] || die "no audio files in $input"
  clash=$(sort "$list/targets" | uniq -d | sed -n 1p)
  [ -z "$clash" ] || die "two recordings would be tiled into $clash: rename one of them"
  todo=$((found - skipped))
  echo "$input: $found recordings, $skipped tiled already, $todo to tile"
  [ "$todo" -gt 0 ] || exit 0
  # Each recording is tiled on its own, so one that fails stops none of the
  # others; each that succeeds says so in the done list
  export MAKE_TILES_DONE="$list/done"
  xargs -0 -n 2 -P "$jobs" bash "$0" ${opts[@]+"${opts[@]}"} < "$list/todo" || true
  failed=0
  while IFS= read -r -d '' file && IFS= read -r -d '' target; do
    if ! grep -Fxq -- "$target" "$list/done"; then
      failed=$((failed + 1))
      echo "make-tiles.sh: not tiled: $file" >&2
    fi
  done < "$list/todo"
  echo "$input: $((todo - failed)) tiled, $failed failed"
  [ "$failed" -eq 0 ] || exit 1
  exit 0
fi
[ -f "$input" ] || die "no such file or folder: $input"

isNumber() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }

# OUTDIR must be empty or hold only what this makes: anything else there
# suggests it was given by mistake (a home folder, a website), and is not to be
# overwritten. Earlier versions made one level, its tiles beside the manifest
# and its peaks in peaks.json, so those are known too.
if [ -d "$outdir" ]; then
  for f in "$outdir"/*; do
    [ -e "$f" ] || continue
    name=${f##*/}
    case "$name" in
      index.json) grep -q '"tiled-spectrogram"' "$f" ||
        die "$outdir/index.json is not a tiles manifest, so $outdir is not for tiles" ;;
      peaks.json|peaks-*.json) grep -q '"samples_per_pixel"' "$f" ||
        die "$outdir/$name is not waveform peaks, so $outdir is not for tiles" ;;
      *.jpg) isNumber "${name%.jpg}" || die "$outdir holds $name, so it is not for tiles" ;;
      *)
        if ! isNumber "$name" || [ ! -d "$f" ]; then die "$outdir holds $name, so it is not for tiles"; fi
        for g in "$f"/*; do
          [ -e "$g" ] || continue
          leaf=${g##*/}
          if [ "${leaf%.jpg}" = "$leaf" ] || ! isNumber "${leaf%.jpg}"; then
            die "$outdir/$name holds $leaf, so $outdir is not for tiles"
          fi
        done ;;
    esac
  done
fi
# Earlier tiles go, and until every tile has been made again there is no manifest
rm -f "$outdir/index.json"
for f in "$outdir"/peaks.json "$outdir"/peaks-*.json "$outdir"/*.jpg; do [ ! -e "$f" ] || rm -f "$f"; done
for f in "$outdir"/*; do
  if [ -d "$f" ] && isNumber "${f##*/}"; then rm -rf "${f:?}"; fi
done

probe() {
  ffprobe -v error -select_streams a:0 -show_entries "stream=$1" -of csv=p=0 "$2" | tr -d '\r' | head -n 1
}

rate=$(probe sample_rate "$input")
channels=$(probe channels "$input")
[ -n "$rate" ] || die "no audio in $input"
[ "$channel" -lt "$channels" ] || die "$input has $channels channels, so there is no channel $channel"

# Above 96 kHz a 512-point FFT window is under a third of a column of 86 a
# second, so the finest level is four times finer, in tiles four times
# shorter, and the next level is what lower rates have finest
if [ "$rate" -gt 96000 ] && [ "$pps_given" -eq 0 ] && [ "$tile_seconds_given" -eq 0 ]; then
  pps=$((pps * 4))
  tile_seconds=$(awk -v s="$tile_seconds" 'BEGIN { print s / 4 }')
fi

# Loudness in ffmpeg's terms: its dynamic range, and the level it shows as
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

# The levels, by their samples a column: the finest, then each four times
# coarser until one tile covers the recording. Every tile of every level is
# $width columns across, so a coarser tile covers four tiles of the level below.
levels=("$spc")
while :; do
  last=${levels[${#levels[@]} - 1]}
  [ $(( (samples + width * last - 1) / (width * last) )) -gt 1 ] || break
  levels+=("$((last * 4))")
done

# The finest level, analysed from the audio. Where there are coarser levels to
# make from it, each tile is kept lossless too, as PNG, to make them from.
mkdir -p "$outdir/$spc" "$tmp/level0"
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
  graph="atrim=end_sample=${tile_samples},apad=whole_len=${tile_samples},showspectrumpic=s=${width}x${height}:legend=0:mode=combined:color=channel:scale=log:fscale=lin:win_func=hann:drange=${drange}:limit=${limit},format=gray,negate${crop}"
  if [ "${#levels[@]}" -gt 1 ]; then
    ffmpeg -v error -nostdin -y -ss "$start" -i "$mono" -lavfi "$graph,split=2[jpg][png]" \
      -map "[jpg]" -frames:v 1 -q:v "$quality" "$outdir/$spc/$i.jpg" \
      -map "[png]" -frames:v 1 "$tmp/level0/$i.png"
  else
    ffmpeg -v error -nostdin -y -ss "$start" -i "$mono" -lavfi "$graph" \
      -frames:v 1 -q:v "$quality" "$outdir/$spc/$i.jpg"
  fi
done

# Each coarser level from the one below: four of its tiles side by side, each
# run of four columns kept as the darkest pixel of its row, the loudest, so
# that a sound shorter than a column still shows. White (silence) pads the width
# to a multiple of four; eroding towards the right three times leaves each pixel
# the darkest of itself and the three after it; and every fourth column, those
# starting a run, is kept by taking alternate lines of the image turned on its
# side, twice.
pool="pad=ceil(iw/4)*4:ih:0:0:white,erosion=coordinates=16,erosion=coordinates=16,erosion=coordinates=16"
pool="$pool,transpose=clock,il=l=d:c=d,crop=iw:ih/2:0:0,il=l=d:c=d,crop=iw:ih/2:0:0,transpose=cclock"
below="$tmp/level0"
for ((k = 1; k < ${#levels[@]}; k++)); do
  level=${levels[$k]}
  level_samples=$((width * level))
  level_count=$(( (samples + level_samples - 1) / level_samples ))
  above="$tmp/level$k"
  mkdir -p "$outdir/$level" "$above"
  for ((j = 0; j < level_count; j++)); do
    inputs=()
    pads=""
    for ((m = 4 * j; m < 4 * j + 4; m++)); do
      [ -f "$below/$m.png" ] || break
      inputs+=(-i "$below/$m.png")
      pads="$pads[$((m - 4 * j))]"
    done
    n=$(( ${#inputs[@]} / 2 ))
    [ "$n" -gt 0 ] || die "no tiles of the level below to make tile $j of level $k from"
    left=$((samples - j * level_samples))
    columns=$width
    [ "$left" -ge "$level_samples" ] || columns=$(( (left + level - 1) / level ))
    stack=""
    [ "$n" -eq 1 ] || stack="hstack=inputs=$n,"
    graph="${pads}${stack}format=gray,${pool},crop=${columns}:ih:0:0"
    if [ $((k + 1)) -lt "${#levels[@]}" ]; then
      ffmpeg -v error -nostdin -y "${inputs[@]}" -filter_complex "$graph,split=2[jpg][png]" \
        -map "[jpg]" -frames:v 1 -q:v "$quality" "$outdir/$level/$j.jpg" \
        -map "[png]" -frames:v 1 "$above/$j.png"
    else
      ffmpeg -v error -nostdin -y "${inputs[@]}" -filter_complex "$graph" \
        -frames:v 1 -q:v "$quality" "$outdir/$level/$j.jpg"
    fi
  done
  rm -rf "${below:?}"
  below=$above
done

# Waveform peaks: the lowest and highest sample of each column of the channel
# shown, a file for each level, in the BBC audiowaveform JSON format (version 2,
# 16-bit). Those of the finest level come from the audio: ffmpeg runs in the
# temporary folder so that no path in a filter needs escaping, and astats'
# measure options (ffmpeg 4.4 on) make it five times quicker, an older ffmpeg
# being asked without them. Each point of a coarser level is the lowest and
# highest of the four points below it.
if [ "$peaks" -eq 1 ]; then
  (
    cd "$tmp"
    blocks="asetnsamples=n=${spc}:p=0,astats=metadata=1:reset=1"
    ffmpeg -v quiet -nostdin -i mono.wav -af \
      "${blocks}:measure_perchannel=Min_level+Max_level:measure_overall=none,ametadata=mode=print:file=levels.txt" \
      -f null - || {
      rm -f levels.txt
      ffmpeg -v error -nostdin -i mono.wav -af \
        "${blocks},ametadata=mode=print:key=lavfi.astats.1.Min_level:file=levels.txt,ametadata=mode=print:key=lavfi.astats.1.Max_level:file=levels-max.txt" \
        -f null -
    }
  )
  awk -v rate="$rate" -v levels="${levels[*]}" -v dir="$tmp" '
    function int16(x) { x = x * 32768; x = (x < 0) ? int(x - 0.5) : int(x + 0.5); return x < -32768 ? -32768 : (x > 32767 ? 32767 : x) }
    /\.Min_level=/ { sub(/.*=/, ""); low[++n] = int16($0) }
    /\.Max_level=/ { sub(/.*=/, ""); high[++m] = int16($0) }
    END {
      if (n == 0 || n != m) exit 1
      count = split(levels, spc, " ")
      for (level = 1; level <= count; level++) {
        if (level > 1) {
          k = 0
          for (i = 1; i <= n; i += 4) {
            lo = low[i]; hi = high[i]
            for (j = i + 1; j < i + 4 && j <= n; j++) { if (low[j] < lo) lo = low[j]; if (high[j] > hi) hi = high[j] }
            k++; low[k] = lo; high[k] = hi
          }
          n = k
        }
        file = dir "/peaks-" spc[level] ".json"
        printf "{\"version\":2,\"channels\":1,\"sample_rate\":%d,\"samples_per_pixel\":%d,\"bits\":16,\"length\":%d,\"data\":[", rate, spc[level], n > file
        for (i = 1; i <= n; i++) printf "%s%d,%d", (i > 1 ? "," : ""), low[i], high[i] > file
        printf "]}\n" > file
        close(file)
      }
    }' "$tmp"/levels*.txt || die "could not make the waveform peaks of $input"
  for level in "${levels[@]}"; do mv "$tmp/peaks-$level.json" "$outdir/peaks-$level.json"; done
fi

# The manifest is written last, and only once every tile has been
awk -v rate="$rate" -v samples="$samples" -v width="$width" -v height="$height" -v levels="${levels[*]}" \
    -v channel="$channel" -v drange="$drange" -v limit="$limit" -v gain="$gain_db" -v range="$range_db" \
    -v calibration="$calibration" -v peaks="$peaks" 'BEGIN {
  count = split(levels, spc, " ")
  printf "{\n"
  printf "  \"type\": \"tiled-spectrogram\",\n  \"version\": 1,\n"
  printf "  \"duration\": %.6f,\n", samples / rate
  printf "  \"sampleRate\": %d,\n  \"channel\": %d,\n", rate, channel
  printf "  \"frequencyMin\": 0,\n  \"frequencyMax\": %s,\n  \"frequencyScale\": \"linear\",\n", rate / 2
  printf "  \"window\": \"hann\",\n  \"colorMap\": \"gray\",\n"
  printf "  \"dbRange\": [%s, %s],\n", -gain - range, -gain
  printf "  \"levels\": [\n"
  for (k = 1; k <= count; k++) {
    s = spc[k]
    printf "    {\"width\": %d, \"height\": %d, \"tileDuration\": %.9f, \"tileCount\": %d, \"tiles\": \"%d/{index}.jpg\", ", width, height, width * s / rate, int((samples + width * s - 1) / (width * s)), s
    printf "\"mimeType\": \"image/jpeg\", \"samplesPerColumn\": %d, \"pixelsPerSecond\": %.6f, \"fftSize\": %d}%s\n", s, rate / s, 2 * height, (k < count ? "," : "")
  }
  printf "  ],\n"
  if (peaks == 1) {
    printf "  \"peaks\": [\n"
    for (k = 1; k <= count; k++) {
      printf "    {\"pointsPerSecond\": %.6f, \"samplesPerPixel\": %d, \"url\": \"peaks-%d.json\"}%s\n", rate / spc[k], spc[k], spc[k], (k < count ? "," : "")
    }
    printf "  ],\n"
  }
  printf "  \"renderer\": {\"name\": \"ffmpeg showspectrumpic\", \"scale\": \"log\", \"drange\": %s, \"limit\": %s},\n", drange, limit
  printf "  \"calibration\": \"%s\"\n", calibration
  printf "}\n"
}' > "$outdir/index.json"

made="$tile_count tiles"
[ "$tile_count" -ne 1 ] || made="1 tile"
if [ "${#levels[@]}" -gt 1 ]; then
  echo "$outdir: ${#levels[@]} levels; the finest, $made of ${width}x${height} at $spc samples a column ($rate Hz)"
else
  echo "$outdir: 1 level, $made of ${width}x${height} at $spc samples a column ($rate Hz)"
fi
# In a folder's run, say this recording is done
[ -z "${MAKE_TILES_DONE:-}" ] || printf '%s\n' "$outdir" >> "$MAKE_TILES_DONE"

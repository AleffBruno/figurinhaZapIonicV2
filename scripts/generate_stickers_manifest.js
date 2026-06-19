#!/usr/bin/env node
/**
 * Cordova hook: before_prepare
 * Scans www/assets/imgs/ subdirectories and generates www/contents.json
 * in the official WhatsApp stickers format so the ContentProvider can
 * discover packs that ship with the Ionic build output.
 *
 * Each subfolder of www/assets/imgs/ is a sticker pack:
 *   - folder name  = pack identifier
 *   - tray.png OR tray.webp = tray icon
 *   - every other *.webp    = a sticker
 *   - *.gif                = auto-converted to an animated *.webp sticker
 *   - optional pack.json   = { name, publisher, animated, stickers: { "<file>": { emojis, accessibility_text } } }
 *
 * Animated sticker support:
 *   - *.gif files are converted to animated *.webp (512x512, <=500KB) using
 *     sharp. If a <basename>.webp already exists the gif is skipped (the
 *     pre-made webp wins), so both authored .webp and .gif sources work.
 *   - A pack is flagged animated_sticker_pack=true when any of its sticker
 *     webp files contain an ANIM/ANMF/VP8X-animation chunk, OR pack.json
 *     sets "animated": true. pack.json "animated": false forces static.
 *   - For ANIMATED packs, any static *.webp sticker is auto-promoted to a
 *     looping 2-frame animated WebP (same frame repeated at 100ms, loop 0)
 *     built directly from the static bitstream -- no re-encode on the happy
 *     path. This satisfies WhatsApp's "all stickers must animate" rule
 *     (StickerPackValidator: frameCount>1) so mixed static/animated packs
 *     are handled automatically. Static packs are left untouched.
 *
 * Defaults when pack.json is absent:
 *   name = folder name, publisher = "FigurinhaZap", emojis = ["😀"]
 */
var fs = require('fs');
var path = require('path');

function findProjectRoot() {
  var dir = process.cwd();
  for (var i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'config.xml')) && fs.existsSync(path.join(dir, 'www'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function isStickerFile(name) {
  return name.toLowerCase().endsWith('.webp');
}

function isTrayFile(name) {
  var lower = name.toLowerCase();
  return lower === 'tray.png' || lower === 'tray.webp';
}

function isGifFile(name) {
  return name.toLowerCase().endsWith('.gif');
}

/**
 * Pure-Node animated WebP detector. Scans RIFF chunks for animation markers
 * (VP8X animation flag, ANIM chunk, or any ANMF frame chunk). Avoids pulling
 * in a native image decoder just to set the manifest flag.
 */
function isAnimatedWebp(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  var offset = 12;
  while (offset + 8 <= buf.length) {
    var fourcc = buf.toString('ascii', offset, offset + 4);
    var size = buf.readUInt32LE(offset + 4);
    if (fourcc === 'VP8X' && offset + 9 <= buf.length && (buf[offset + 8] & 0x02)) {
      return true;
    }
    if (fourcc === 'ANIM' || fourcc === 'ANMF') return true;
    var padded = size + (size % 2);
    offset += 8 + padded;
  }
  return false;
}

var ANIMATED_STICKER_FILE_LIMIT_KB = 500;

/**
 * Convert an animated GIF to an animated WebP sticker (512x512, <=500KB)
 * using sharp. Writes <basename>.webp next to the gif. Returns the output
 * filename, or null if conversion was skipped or failed.
 */
async function convertGifToWebp(packDir, gifName) {
  var base = gifName.replace(/\.gif$/i, '');
  var webpName = base + '.webp';
  var webpPath = path.join(packDir, webpName);
  if (fs.existsSync(webpPath)) {
    console.warn('[stickers] WARNING: "' + gifName + '" skipped, pre-made "' + webpName + '" already exists.');
    return null;
  }
  var sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.warn('[stickers] WARNING: "sharp" not installed, cannot convert "' + gifName + '". Run: yarn add -D sharp');
    return null;
  }
  var gifPath = path.join(packDir, gifName);
  var qualities = [80, 70, 60, 50, 40, 30, 20];
  var limitBytes = ANIMATED_STICKER_FILE_LIMIT_KB * 1024;
  var chosen = null;
  for (var i = 0; i < qualities.length; i++) {
    var buf;
    try {
      buf = await sharp(fs.readFileSync(gifPath), { animated: true })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: qualities[i], alphaQuality: 100, loop: 0 })
        .toBuffer();
    } catch (e) {
      console.warn('[stickers] WARNING: sharp failed to convert "' + gifName + '": ' + e.message);
      return null;
    }
    chosen = buf;
    if (buf.length <= limitBytes) break;
  }
  if (chosen.length > limitBytes) {
    console.warn('[stickers] WARNING: "' + gifName + '" -> ' + Math.round(chosen.length / 1024) +
      'KB exceeds the ' + ANIMATED_STICKER_FILE_LIMIT_KB + 'KB WhatsApp animated limit.');
  }
  fs.writeFileSync(webpPath, chosen);
  console.log('[stickers] Converted "' + gifName + '" -> "' + webpName + '" (' + Math.round(chosen.length / 1024) + 'KB).');
  return webpName;
}

/* ---------------------------------------------------------------------------
 * Static -> animated WebP promotion (pure-Node RIFF container builder).
 * Used only for ANIMATED packs so every sticker satisfies WhatsApp's
 * "frameCount > 1" rule. Reuses the static bitstream verbatim -- no
 * re-encode on the happy path, so quality is lossless and it's fast.
 * ------------------------------------------------------------------------- */

var STICKER_EDGE = 512;
var STATIC_FRAME_DURATION_MS = 100;
var STATIC_FRAME_COUNT = 2;

function readU32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function w24(v) {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

/** Build a RIFF chunk with even-padded payload (RIFF chunks must be word-aligned). */
function riffChunk(fourcc, data) {
  var pad = data.length % 2;
  var sz = Buffer.alloc(4);
  sz.writeUInt32LE(data.length, 0);
  var parts = [Buffer.from(fourcc, 'ascii'), sz, data];
  if (pad) parts.push(Buffer.alloc(1));
  return Buffer.concat(parts);
}

/** Parse a single-frame WebP into its bitstream sub-chunks. */
function parseSingleFrameWebp(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  var vp8 = null, vp8l = null, alph = null, vp8x = null;
  var offset = 12;
  while (offset + 8 <= buf.length) {
    var fourcc = buf.toString('ascii', offset, offset + 4);
    var size = readU32(buf, offset + 4);
    var data = buf.slice(offset + 8, offset + 8 + size);
    if (fourcc === 'VP8 ' && !vp8) vp8 = data;
    else if (fourcc === 'VP8L' && !vp8l) vp8l = data;
    else if (fourcc === 'ALPH' && !alph) alph = data;
    else if (fourcc === 'VP8X' && !vp8x) vp8x = data;
    offset += 8 + size + (size % 2);
  }
  return { vp8: vp8, vp8l: vp8l, alph: alph, vp8x: vp8x };
}

/** Read canvas dims straight from the bitstream header (VP8 or VP8L). */
function dimsFromBitstream(parsed) {
  if (parsed.vp8) {
    var d = parsed.vp8;
    if (d.length >= 10) return { w: d[6] | (d[7] << 8), h: d[8] | (d[9] << 8) };
  }
  if (parsed.vp8l) {
    var b = parsed.vp8l;
    if (b.length >= 6) {
      var w = 1 + ((b[1] | (b[2] << 8) | (b[3] << 4)) & 0x3fff);
      var h = 1 + ((b[3] >> 4 | (b[4] << 4) | (b[5] << 12)) & 0x3fff);
      return { w: w, h: h };
    }
  }
  return null;
}

/**
 * Build an animated WebP from a single-frame WebP by repeating its bitstream
 * as N identical full-canvas frames. Output is a valid animated WebP:
 *   VP8X(animation flag | alpha-if-needed, canvas WxH)
 *   ANIM(bgcolor 0, loop 0)
 *   N x ANMF(x=0,y=0,W,H,durationMs,flags=0, <same bitstream sub-chunks>)
 * Returns a Buffer, or null on failure.
 */
function buildAnimatedWebpFromStatic(staticBuf, frameCount, durationMs) {
  var parsed = parseSingleFrameWebp(staticBuf);
  if (!parsed) return null;
  var hasAlpha = !!parsed.alph || !!parsed.vp8l;
  var frameSubs = [];
  if (parsed.alph) frameSubs.push(riffChunk('ALPH', parsed.alph));
  if (parsed.vp8) frameSubs.push(riffChunk('VP8 ', parsed.vp8));
  else if (parsed.vp8l) frameSubs.push(riffChunk('VP8L', parsed.vp8l));
  else return null;
  var frameBitstream = Buffer.concat(frameSubs);

  var dims = dimsFromBitstream(parsed);
  var W = (dims && dims.w) || STICKER_EDGE;
  var H = (dims && dims.h) || STICKER_EDGE;

  // VP8X flags: bit1 (0x02) = animation, bit4 (0x10) = alpha.
  var flags = 0x02 | (hasAlpha ? 0x10 : 0);
  var vp8xData = Buffer.from([flags, 0, 0, 0].concat(w24(W - 1), w24(H - 1)));
  var animData = Buffer.alloc(6);
  animData.writeUInt32LE(0x00000000, 0);
  animData.writeUInt16LE(0, 4);

  var frames = [];
  for (var i = 0; i < frameCount; i++) {
    var hdr = Buffer.from(
      w24(0).concat(w24(0), w24(W - 1), w24(H - 1), w24(durationMs), 0x00)
    );
    frames.push(riffChunk('ANMF', Buffer.concat([hdr, frameBitstream])));
  }

  var body = Buffer.concat([riffChunk('VP8X', vp8xData), riffChunk('ANIM', animData)].concat(frames));
  var riff = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), body]);
  riff.writeUInt32LE(body.length + 4, 4);
  return riff;
}

/**
 * Re-encode a WebP to 512x512 static at the given quality (sharp fallback,
 * only used when the source isn't already 512x512 or the built file is too
 * big to fit WhatsApp's animated limit).
 */
async function reencodeStaticWebp(srcBuf, quality) {
  var sharp = require('sharp');
  return await sharp(srcBuf)
    .resize(STICKER_EDGE, STICKER_EDGE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: quality, alphaQuality: 100 })
    .toBuffer();
}

/**
 * Promote a static *.webp sticker to a looping animated WebP in place.
 * Idempotent: already-animated files are skipped. If the source isn't
 * 512x512 (or the first build exceeds the 500KB animated limit) the frame
 * is re-encoded via sharp at decreasing quality and rebuilt. Overwrites
 * the same filename in packDir. Returns true if the file is now animated.
 */
async function convertStaticToAnimatedWebp(packDir, fileName) {
  var filePath = path.join(packDir, fileName);
  var srcBuf;
  try {
    srcBuf = fs.readFileSync(filePath);
  } catch (e) {
    console.warn('[stickers] WARNING: cannot read "' + fileName + '": ' + e.message);
    return false;
  }
  if (isAnimatedWebp(srcBuf)) return true;

  var parsed = parseSingleFrameWebp(srcBuf);
  var dims = parsed ? dimsFromBitstream(parsed) : null;
  var needsReencode = !dims || dims.w !== STICKER_EDGE || dims.h !== STICKER_EDGE;

  var limitBytes = ANIMATED_STICKER_FILE_LIMIT_KB * 1024;
  var candidates = [srcBuf];
  if (needsReencode) {
    candidates = [];
    var qualities = [90, 80, 70, 60, 50, 40, 30, 20];
    for (var i = 0; i < qualities.length; i++) {
      try {
        candidates.push(await reencodeStaticWebp(srcBuf, qualities[i]));
      } catch (e) {
        console.warn('[stickers] WARNING: sharp re-encode failed for "' + fileName + '": ' + e.message);
        break;
      }
    }
    if (!candidates.length) candidates = [srcBuf];
  }

  var best = null;
  for (var c = 0; c < candidates.length; c++) {
    var built = buildAnimatedWebpFromStatic(candidates[c], STATIC_FRAME_COUNT, STATIC_FRAME_DURATION_MS);
    if (!built) continue;
    best = built;
    if (built.length <= limitBytes) break;
  }
  if (!best) {
    console.warn('[stickers] WARNING: could not promote "' + fileName + '" to animated.');
    return false;
  }
  if (best.length > limitBytes) {
    // Last resort: drop to 1 quality floor and warn; still write so the pack
    // isn't left with a static file that would fail validation.
    console.warn('[stickers] WARNING: "' + fileName + '" -> ' + Math.round(best.length / 1024) +
      'KB exceeds the ' + ANIMATED_STICKER_FILE_LIMIT_KB + 'KB animated limit.');
  }
  fs.writeFileSync(filePath, best);
  console.log('[stickers] Promoted static "' + fileName + '" -> animated (' +
    Math.round(best.length / 1024) + 'KB, ' + STATIC_FRAME_COUNT + ' frames x ' + STATIC_FRAME_DURATION_MS + 'ms).');
  return true;
}

async function buildPack(folderName, packDir) {
  var entries = fs.readdirSync(packDir);

  var gifs = entries.filter(isGifFile);
  for (var g = 0; g < gifs.length; g++) {
    await convertGifToWebp(packDir, gifs[g]);
  }

  entries = fs.readdirSync(packDir);
  var trayFile = null;
  var stickerFiles = [];

  entries.forEach(function (entry) {
    if (isTrayFile(entry)) {
      trayFile = entry;
    } else if (isStickerFile(entry)) {
      stickerFiles.push(entry);
    }
  });

  stickerFiles.sort();

  if (!trayFile) {
    console.warn('[stickers] WARNING: pack "' + folderName + '" has no tray.png/tray.webp — skipping.');
    return null;
  }
  if (stickerFiles.length < 3) {
    console.warn('[stickers] WARNING: pack "' + folderName + '" has only ' + stickerFiles.length +
      ' sticker(s), WhatsApp requires at least 3 — skipping.');
    return null;
  }
  if (stickerFiles.length > 30) {
    console.warn('[stickers] WARNING: pack "' + folderName + '" has ' + stickerFiles.length +
      ' stickers, WhatsApp allows at most 30 — only the first 30 will be used.');
    stickerFiles = stickerFiles.slice(0, 30);
  }

  var packJson = null;
  var packJsonPath = path.join(packDir, 'pack.json');
  if (fs.existsSync(packJsonPath)) {
    try {
      packJson = JSON.parse(fs.readFileSync(packJsonPath, 'utf8'));
    } catch (e) {
      console.warn('[stickers] WARNING: pack "' + folderName + '" has invalid pack.json — using defaults.');
      packJson = null;
    }
  }

  var name = (packJson && packJson.name) ? packJson.name : folderName;
  var publisher = (packJson && packJson.publisher) ? packJson.publisher : 'FigurinhaZap';
  var stickerMeta = (packJson && packJson.stickers) ? packJson.stickers : {};

  var detectedAnimated = false;
  for (var s = 0; s < stickerFiles.length; s++) {
    try {
      var webpBuf = fs.readFileSync(path.join(packDir, stickerFiles[s]));
      if (isAnimatedWebp(webpBuf)) {
        detectedAnimated = true;
        break;
      }
    } catch (e) {
      /* ignore single-file read errors, treat as static */
    }
  }
  var animated;
  if (packJson && typeof packJson.animated === 'boolean') {
    animated = packJson.animated;
  } else {
    animated = detectedAnimated;
  }

  if (animated) {
    for (var a = 0; a < stickerFiles.length; a++) {
      await convertStaticToAnimatedWebp(packDir, stickerFiles[a]);
    }
  }

  var stickers = stickerFiles.map(function (file) {
    var meta = stickerMeta[file] || {};
    var emojis = meta.emojis && meta.emojis.length ? meta.emojis : ['😀'];
    var entry = { image_file: file, emojis: emojis };
    if (meta.accessibility_text) {
      entry.accessibility_text = meta.accessibility_text;
    }
    return entry;
  });

  return {
    identifier: folderName,
    name: name,
    publisher: publisher,
    tray_image_file: trayFile,
    image_data_version: '1',
    avoid_cache: false,
    publisher_email: '',
    publisher_website: '',
    privacy_policy_website: '',
    license_agreement_website: '',
    animated_sticker_pack: animated,
    stickers: stickers
  };
}

module.exports = async function (ctx) {
  var root = findProjectRoot();
  var imgsDir = path.join(root, 'www', 'assets', 'imgs');
  var manifestPath = path.join(root, 'www', 'contents.json');

  if (!fs.existsSync(imgsDir)) {
    console.log('[stickers] www/assets/imgs not found, writing empty manifest.');
    fs.writeFileSync(manifestPath, JSON.stringify({
      android_play_store_link: '',
      ios_app_store_link: '',
      sticker_packs: []
    }, null, 2));
    return;
  }

  var entries = fs.readdirSync(imgsDir);
  var packs = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var packDir = path.join(imgsDir, entry);
    if (fs.statSync(packDir).isDirectory()) {
      var pack = await buildPack(entry, packDir);
      if (pack) {
        packs.push(pack);
      }
    }
  }

  var manifest = {
    android_play_store_link: '',
    ios_app_store_link: '',
    sticker_packs: packs
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('[stickers] Generated www/contents.json with ' + packs.length + ' pack(s): ' +
    (packs.length ? packs.map(function (p) {
      return p.identifier + (p.animated_sticker_pack ? ' (animated)' : '');
    }).join(', ') : '(none)'));
};

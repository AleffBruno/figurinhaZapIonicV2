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
 *   - optional pack.json    = { name, publisher, stickers: { "<file>": { emojis, accessibility_text } } }
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

function buildPack(folderName, packDir) {
  var entries = fs.readdirSync(packDir);
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
    stickers: stickers
  };
}

module.exports = function (ctx) {
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

  entries.forEach(function (entry) {
    var packDir = path.join(imgsDir, entry);
    if (fs.statSync(packDir).isDirectory()) {
      var pack = buildPack(entry, packDir);
      if (pack) {
        packs.push(pack);
      }
    }
  });

  var manifest = {
    android_play_store_link: '',
    ios_app_store_link: '',
    sticker_packs: packs
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('[stickers] Generated www/contents.json with ' + packs.length + ' pack(s): ' +
    (packs.length ? packs.map(function (p) { return p.identifier; }).join(', ') : '(none)'));
};

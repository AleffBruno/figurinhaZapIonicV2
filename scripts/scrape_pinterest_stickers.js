#!/usr/bin/env node
/**
 * Scrape public image search results into src/assets/imgs/<pack>/ so the existing
 * generate_stickers_manifest.js pipeline can convert them into WhatsApp packs.
 *
 * Usage:
 *   node scripts/scrape_pinterest_stickers.js --source pinterest --query "funny cats" --pack funny-cats --limit 30
 *   node scripts/scrape_pinterest_stickers.js --source google --query "funny cats" --pack funny-cats --limit 30
 *   node scripts/scrape_pinterest_stickers.js --url "https://www.pinterest.com/search/pins/?q=memes" --pack memes --replace
 *
 * Use only images you have rights to use. This script does not log in or bypass
 * search provider access controls; it reads public pages only.
 */
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var crypto = require('crypto');

var DEFAULT_LIMIT = 30;
var MIN_STICKERS = 3;
var MAX_STICKERS = 30;
var DEFAULT_PUBLISHER = 'FigurinhaZap';
var DEFAULT_MIN_LONG_EDGE = 512;
var DEFAULT_MIN_SHORT_EDGE = 256;
var DEFAULT_SOURCE = 'pinterest';
var REQUEST_TIMEOUT_MS = 30000;
var MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

function usage(exitCode) {
  var out = exitCode ? console.error : console.log;
  out([
    'Usage:',
    '  node scripts/scrape_pinterest_stickers.js --query "funny cats" --pack funny-cats [--limit 30]',
    '  node scripts/scrape_pinterest_stickers.js --source google --query "funny cats" --pack funny-cats',
    '  node scripts/scrape_pinterest_stickers.js --url "https://www.pinterest.com/search/pins/?q=funny%20cats" --pack funny-cats',
    '',
    'Options:',
    '  --source <name>     Scraper source: pinterest or google. Default: pinterest.',
    '  --method <name>     Alias for --source.',
    '  --query <text>      Search query. Mutually exclusive with --url.',
    '  --url <url>         Public source URL to scrape. Mutually exclusive with --query.',
    '  --pack <name>       Output pack folder under src/assets/imgs/. Required.',
    '  --limit <number>    Stickers to save, from 3 to 30. Default: 30.',
    '  --publisher <name>  metadata.json publisher. Default: FigurinhaZap.',
    '  --min-long-edge <n> Skip images whose longest side is below n. Default: 512.',
    '  --min-short-edge <n> Skip images whose shortest side is below n. Default: 256.',
    '  --prefer-originals  Try Pinterest original-size CDN URLs first. Default: on.',
    '  --no-prefer-originals Disable original-size CDN URL probing.',
    '  --replace           Replace image files in an existing pack folder.',
    '  --headful           Show Chromium instead of running headless.',
    '  --help              Show this help.',
    '',
    'After scraping, run: yarn build:assets'
  ].join('\n'));
  process.exit(exitCode);
}

function parseArgs(argv) {
  var args = {};
  for (var i = 0; i < argv.length; i++) {
    var raw = argv[i];
    if (raw === '--help' || raw === '-h') usage(0);
    if (raw === '--replace') {
      args.replace = true;
      continue;
    }
    if (raw === '--headful') {
      args.headful = true;
      continue;
    }
    if (raw === '--prefer-originals') {
      args.preferOriginals = true;
      continue;
    }
    if (raw === '--no-prefer-originals') {
      args.preferOriginals = false;
      continue;
    }
    if (!raw.startsWith('--')) {
      throw new Error('Unexpected argument: ' + raw);
    }

    var key = raw.slice(2);
    var value;
    var eq = key.indexOf('=');
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else {
      value = argv[++i];
    }
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for --' + key);
    }
    args[key] = value;
  }
  return args;
}

function parseNonNegativeInt(value, flagName) {
  var parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(flagName + ' must be a non-negative number.');
  }
  return parsed;
}

function supportedSourceLabel() {
  return Object.keys(SCRAPERS).join(', ');
}

function normalizeSource(value) {
  var source = String(value || '').toLowerCase().trim();
  if (!source) return '';
  if (!SCRAPERS[source]) {
    throw new Error('Unsupported source "' + source + '". Supported sources: ' + supportedSourceLabel() + '.');
  }
  return source;
}

function getScraper(source) {
  var scraper = SCRAPERS[source];
  if (!scraper) {
    throw new Error('Unsupported source "' + source + '". Supported sources: ' + supportedSourceLabel() + '.');
  }
  return scraper;
}

function findProjectRoot() {
  var dir = process.cwd();
  for (var i = 0; i < 7; i++) {
    if (fs.existsSync(path.join(dir, 'config.xml')) && fs.existsSync(path.join(dir, 'src', 'assets', 'imgs'))) {
      return dir;
    }
    var next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return process.cwd();
}

function sanitizePackName(input) {
  var normalized = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized;
}

function validateOptions(args) {
  if (!args.query && !args.url) {
    throw new Error('Provide --query or --url.');
  }
  if (args.query && args.url) {
    throw new Error('Use either --query or --url, not both.');
  }
  if (!args.pack) {
    throw new Error('Provide --pack.');
  }

  var sourceFromSource = normalizeSource(args.source || '');
  var sourceFromMethod = normalizeSource(args.method || '');
  if (sourceFromSource && sourceFromMethod && sourceFromSource !== sourceFromMethod) {
    throw new Error('--source and --method must match when both are provided.');
  }
  var source = sourceFromSource || sourceFromMethod || (args.url ? inferSourceFromUrl(args.url) : DEFAULT_SOURCE);
  var scraper = getScraper(source);

  var pack = sanitizePackName(args.pack);
  if (!pack) {
    throw new Error('Pack name must contain at least one letter or number.');
  }

  var limit = args.limit ? parseInt(args.limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit < MIN_STICKERS || limit > MAX_STICKERS) {
    throw new Error('--limit must be a number from ' + MIN_STICKERS + ' to ' + MAX_STICKERS + '.');
  }

  var minLongEdge = args['min-long-edge'] !== undefined
    ? parseNonNegativeInt(args['min-long-edge'], '--min-long-edge')
    : DEFAULT_MIN_LONG_EDGE;
  var minShortEdge = args['min-short-edge'] !== undefined
    ? parseNonNegativeInt(args['min-short-edge'], '--min-short-edge')
    : DEFAULT_MIN_SHORT_EDGE;

  var url = args.url ? scraper.validateUrl(args.url) : scraper.buildSearchUrl(args.query);
  return {
    source: source,
    scraper: scraper,
    query: args.query || '',
    url: url,
    pack: pack,
    displayName: args.pack,
    limit: limit,
    publisher: args.publisher || DEFAULT_PUBLISHER,
    minLongEdge: minLongEdge,
    minShortEdge: minShortEdge,
    preferOriginals: args.preferOriginals !== false,
    replace: Boolean(args.replace),
    headful: Boolean(args.headful)
  };
}

function inferSourceFromUrl(raw) {
  var parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error('Invalid --url: ' + raw);
  }
  var host = parsed.hostname.toLowerCase();
  var sources = Object.keys(SCRAPERS);
  for (var i = 0; i < sources.length; i++) {
    var scraper = SCRAPERS[sources[i]];
    if (hostMatches(host, scraper.allowedHosts)) return scraper.name;
  }
  throw new Error('Could not infer source from --url host "' + host + '". Pass --source with one of: ' + supportedSourceLabel() + '.');
}

function hostMatches(host, allowedHosts) {
  return allowedHosts.some(function (allowed) {
    return host === allowed || host.endsWith('.' + allowed);
  });
}

function validateScraperUrl(raw, scraper) {
  var parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error('Invalid --url: ' + raw);
  }
  var host = parsed.hostname.toLowerCase();
  if (!hostMatches(host, scraper.allowedHosts)) {
    throw new Error('--url must point to ' + scraper.allowedHosts.join(' or ') + ' when --source ' + scraper.name + ' is used.');
  }
  parsed.hash = '';
  return parsed.toString();
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isImageFile(name) {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function preparePackDir(packDir, replace) {
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir, { recursive: true });
    return true;
  }

  var existingImages = fs.readdirSync(packDir).filter(isImageFile);
  if (existingImages.length && !replace) {
    throw new Error('Pack folder already contains images: ' + packDir + '. Re-run with --replace to overwrite them.');
  }
  if (replace) {
    existingImages.forEach(function (file) {
      fs.unlinkSync(path.join(packDir, file));
    });
    ['scrape_sources.json', 'pinterest_sources.json'].forEach(function (file) {
      var filePath = path.join(packDir, file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  }
  return false;
}

function cleanupPartialPack(packDir, savedFiles, removeDirIfEmpty) {
  savedFiles.forEach(function (file) {
    var filePath = path.join(packDir, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  if (removeDirIfEmpty && fs.existsSync(packDir) && fs.readdirSync(packDir).length === 0) {
    fs.rmdirSync(packDir);
  }
}

function normalizeGenericImageUrl(raw, baseUrl) {
  if (!raw) return null;
  var parsed;
  try {
    parsed = new URL(raw, baseUrl || 'https://www.pinterest.com');
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  parsed.hash = '';
  return parsed.toString();
}

function normalizePinterestImageUrl(raw, baseUrl) {
  var url = normalizeGenericImageUrl(raw, baseUrl || 'https://www.pinterest.com');
  if (!url) return null;
  var parsed = new URL(url);
  if (parsed.hostname.toLowerCase().indexOf('pinimg.com') === -1) return null;
  parsed.search = '';
  return parsed.toString();
}

function normalizeGoogleImageUrl(raw, baseUrl) {
  return normalizeGenericImageUrl(raw, baseUrl || 'https://www.google.com');
}

function addImageCandidate(candidates, rawUrl, width, scraper) {
  var url = scraper.normalizeImageUrl(rawUrl);
  if (!url) return;
  width = parseInt(width, 10) || 0;
  var existing = candidates.get(url);
  if (!existing || width > existing.width) {
    candidates.set(url, { url: url, width: width });
  }
}

async function collectPinterestImages(page, targetCount) {
  var candidates = new Map();
  var stagnantRounds = 0;
  var maxRounds = 24;

  for (var round = 0; round < maxRounds && candidates.size < targetCount; round++) {
    var before = candidates.size;
    var found = await page.evaluate(function () {
      function fromSrcset(srcset) {
        if (!srcset) return [];
        return srcset.split(',').map(function (item) {
          var parts = item.trim().split(/\s+/);
          var url = parts[0] || '';
          var width = 0;
          if (parts[1] && /w$/.test(parts[1])) width = parseInt(parts[1], 10) || 0;
          if (parts[1] && /x$/.test(parts[1])) width = parseFloat(parts[1]) * 1000 || 0;
          return { url: url, width: width };
        }).filter(function (item) { return item.url; });
      }

      var result = [];
      Array.prototype.slice.call(document.querySelectorAll('img')).forEach(function (img) {
        result = result.concat(fromSrcset(img.getAttribute('srcset')));
        result = result.concat(fromSrcset(img.getAttribute('data-srcset')));

        [img.currentSrc, img.src, img.getAttribute('src'), img.getAttribute('data-src')].forEach(function (url) {
          if (url) result.push({ url: url, width: img.naturalWidth || img.width || 0 });
        });
      });
      return result;
    });

    found.forEach(function (candidate) {
      addImageCandidate(candidates, candidate.url, candidate.width, SCRAPERS.pinterest);
    });

    if (candidates.size === before) stagnantRounds++;
    else stagnantRounds = 0;
    if (stagnantRounds >= 5) break;

    await page.evaluate(function () {
      window.scrollBy(0, Math.max(document.documentElement.clientHeight, 900));
    });
    await sleep(1200);
  }

  return Array.from(candidates.values()).sort(function (a, b) {
    return b.width - a.width;
  });
}

async function collectGoogleImages(page, targetCount) {
  var candidates = new Map();
  var stagnantRounds = 0;
  var maxRounds = 24;

  for (var round = 0; round < maxRounds && candidates.size < targetCount; round++) {
    var before = candidates.size;
    var found = await page.evaluate(function () {
      function fromSrcset(srcset) {
        if (!srcset) return [];
        return srcset.split(',').map(function (item) {
          var parts = item.trim().split(/\s+/);
          var url = parts[0] || '';
          var width = 0;
          if (parts[1] && /w$/.test(parts[1])) width = parseInt(parts[1], 10) || 0;
          if (parts[1] && /x$/.test(parts[1])) width = parseFloat(parts[1]) * 1000 || 0;
          return { url: url, width: width };
        }).filter(function (item) { return item.url; });
      }

      var result = [];
      Array.prototype.slice.call(document.querySelectorAll('a[href]')).forEach(function (a) {
        try {
          var link = new URL(a.href, location.href);
          var imgurl = link.searchParams.get('imgurl');
          if (imgurl) result.push({ url: imgurl, width: 100000 });
        } catch (e) {
          /* ignore malformed hrefs */
        }
      });

      Array.prototype.slice.call(document.querySelectorAll('img')).forEach(function (img) {
        result = result.concat(fromSrcset(img.getAttribute('srcset')));
        result = result.concat(fromSrcset(img.getAttribute('data-srcset')));
        [
          img.currentSrc,
          img.src,
          img.getAttribute('src'),
          img.getAttribute('data-src'),
          img.getAttribute('data-iurl')
        ].forEach(function (url) {
          if (url) result.push({ url: url, width: img.naturalWidth || img.width || 0 });
        });
      });
      return result;
    });

    found.forEach(function (candidate) {
      addImageCandidate(candidates, candidate.url, candidate.width, SCRAPERS.google);
    });

    if (candidates.size === before) stagnantRounds++;
    else stagnantRounds = 0;
    if (stagnantRounds >= 5) break;

    await page.evaluate(function () {
      window.scrollBy(0, Math.max(document.documentElement.clientHeight, 900));
    });
    await sleep(1200);
  }

  return Array.from(candidates.values()).sort(function (a, b) {
    return b.width - a.width;
  });
}

function addUnique(list, value) {
  if (list.indexOf(value) === -1) list.push(value);
}

function pinterestImageVariants(rawUrl, preferOriginals) {
  var variants = [];
  var parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return [rawUrl];
  }

  parsed.search = '';
  parsed.hash = '';
  var originalUrl = parsed.toString();
  var parts = parsed.pathname.split('/');
  var sizeIndex = -1;
  for (var i = 0; i < parts.length; i++) {
    if (/^(originals|\d+x|\d+x\d+)$/i.test(parts[i])) {
      sizeIndex = i;
      break;
    }
  }

  if (sizeIndex === -1) return [originalUrl];

  var sizes = preferOriginals
    ? ['originals', '1200x', '736x', '564x', '474x']
    : ['1200x', '736x', '564x', '474x'];

  sizes.forEach(function (size) {
    var copy = parts.slice();
    copy[sizeIndex] = size;
    parsed.pathname = copy.join('/');
    addUnique(variants, parsed.toString());
  });
  addUnique(variants, originalUrl);
  return variants;
}

function originalImageVariants(rawUrl) {
  return [rawUrl];
}

async function downloadBestImage(rawUrl, scraper, preferOriginals) {
  var variants = scraper.imageVariants(rawUrl, preferOriginals);
  var lastError = null;
  for (var i = 0; i < variants.length; i++) {
    try {
      return { url: variants[i], buffer: await downloadUrl(variants[i], scraper.referer) };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Could not download image');
}

async function readImageSize(sharp, input) {
  var meta = await sharp(input, { animated: false }).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0
  };
}

function imageIsLargeEnough(size, minLongEdge, minShortEdge) {
  var longEdge = Math.max(size.width, size.height);
  var shortEdge = Math.min(size.width, size.height);
  return longEdge >= minLongEdge && shortEdge >= minShortEdge;
}

function sizeLabel(size) {
  return size.width + 'x' + size.height;
}

function downloadUrl(rawUrl, referer, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    var parsed = new URL(rawUrl);
    var client = parsed.protocol === 'http:' ? http : https;
    var req = client.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
        'referer': referer || 'https://www.pinterest.com/',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
      },
      timeout: REQUEST_TIMEOUT_MS
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new Error('Too many redirects'));
        return resolve(downloadUrl(new URL(res.headers.location, rawUrl).toString(), referer, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }

      var chunks = [];
      var size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) {
          req.destroy(new Error('Image exceeds ' + Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024) + 'MB'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        resolve(Buffer.concat(chunks));
      });
    });

    req.on('timeout', function () {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

async function convertToStickerPng(sharp, input) {
  return sharp(input, { animated: false })
    .rotate()
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function writeMetadata(packDir, options, savedFiles) {
  var stickers = {};
  savedFiles.forEach(function (file) {
    stickers[file.replace(/\.png$/i, '.webp')] = { emojis: ['😀'], accessibility_text: '' };
  });

  var metadata = {
    name: options.displayName,
    publisher: options.publisher,
    publisher_email: '',
    publisher_website: '',
    privacy_policy_website: '',
    license_agreement_website: '',
    animated: null,
    image_data_version: '1',
    image_hash: '',
    stickers: stickers
  };

  fs.writeFileSync(path.join(packDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
}

function writeSources(packDir, options, sources) {
  var payload = {
    scraped_at: new Date().toISOString(),
    source: options.source,
    source_url: options.url,
    query: options.query || null,
    pack: options.pack,
    min_long_edge: options.minLongEdge,
    min_short_edge: options.minShortEdge,
    prefer_originals: options.preferOriginals,
    sources: sources
  };
  fs.writeFileSync(path.join(packDir, 'scrape_sources.json'), JSON.stringify(payload, null, 2) + '\n');
}

var SCRAPERS = {
  pinterest: {
    name: 'pinterest',
    allowedHosts: ['pinterest.com'],
    referer: 'https://www.pinterest.com/',
    buildSearchUrl: function (query) {
      return 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(query);
    },
    validateUrl: function (raw) {
      return validateScraperUrl(raw, this);
    },
    normalizeImageUrl: function (raw) {
      return normalizePinterestImageUrl(raw, 'https://www.pinterest.com');
    },
    collectImages: collectPinterestImages,
    imageVariants: pinterestImageVariants
  },
  google: {
    name: 'google',
    allowedHosts: ['google.com'],
    referer: 'https://www.google.com/',
    buildSearchUrl: function (query) {
      return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query);
    },
    validateUrl: function (raw) {
      return validateScraperUrl(raw, this);
    },
    normalizeImageUrl: function (raw) {
      return normalizeGoogleImageUrl(raw, 'https://www.google.com');
    },
    collectImages: collectGoogleImages,
    imageVariants: originalImageVariants
  }
};

async function main() {
  var options = validateOptions(parseArgs(process.argv.slice(2)));
  var root = findProjectRoot();
  var packDir = path.join(root, 'src', 'assets', 'imgs', options.pack);

  var createdPackDir = preparePackDir(packDir, options.replace);

  var puppeteer;
  var sharp;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('Missing dependency "puppeteer". Run: yarn add -D puppeteer');
  }
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error('Missing dependency "sharp". Run: yarn add -D sharp');
  }

  console.log('[' + options.source + '] Opening ' + options.url);
  var browser = await puppeteer.launch({
    headless: options.headful ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  var imageCandidates;
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36');
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);
    imageCandidates = await options.scraper.collectImages(page, Math.min(options.limit * 8, 240));
  } finally {
    await browser.close();
  }

  if (!imageCandidates.length) {
    throw new Error('No ' + options.source + ' image URLs found. Try a different query or run with --headful to inspect the page.');
  }

  console.log('[' + options.source + '] Found ' + imageCandidates.length + ' candidate image(s). Downloading...');
  console.log('[' + options.source + '] Minimum source size: long edge >= ' + options.minLongEdge + ', short edge >= ' + options.minShortEdge + '.');
  var savedFiles = [];
  var sources = [];
  var seenHashes = new Set();
  var pad = Math.max(2, String(options.limit).length);

  for (var i = 0; i < imageCandidates.length && savedFiles.length < options.limit; i++) {
    var candidate = imageCandidates[i];
    var url = candidate.url;
    try {
      var downloaded = await downloadBestImage(url, options.scraper, options.preferOriginals);
      var size = await readImageSize(sharp, downloaded.buffer);
      if (!imageIsLargeEnough(size, options.minLongEdge, options.minShortEdge)) {
        console.log('[' + options.source + '] Skipped low-resolution image (' + sizeLabel(size) + '): ' + downloaded.url);
        continue;
      }

      var png = await convertToStickerPng(sharp, downloaded.buffer);
      var hash = crypto.createHash('sha256').update(png).digest('hex');
      if (seenHashes.has(hash)) {
        console.log('[' + options.source + '] Skipped duplicate image: ' + downloaded.url);
        continue;
      }
      seenHashes.add(hash);

      var fileName = String(savedFiles.length + 1).padStart(pad, '0') + '.png';
      fs.writeFileSync(path.join(packDir, fileName), png);
      savedFiles.push(fileName);
      sources.push({
        file: fileName,
        url: downloaded.url,
        collected_url: url,
        collected_width: candidate.width || null,
        width: size.width,
        height: size.height
      });
      console.log('[' + options.source + '] Saved ' + options.pack + '/' + fileName + ' from ' + sizeLabel(size));
    } catch (e) {
      console.warn('[' + options.source + '] WARNING: skipped ' + url + ': ' + e.message);
    }
  }

  if (savedFiles.length < MIN_STICKERS) {
    cleanupPartialPack(packDir, savedFiles, createdPackDir);
    throw new Error('Only saved ' + savedFiles.length + ' sticker(s); WhatsApp requires at least ' + MIN_STICKERS + '.');
  }

  writeMetadata(packDir, options, savedFiles);
  writeSources(packDir, options, sources);
  console.log('[' + options.source + '] Created pack "' + options.pack + '" with ' + savedFiles.length + ' sticker(s).');
  console.log('[' + options.source + '] Next: yarn build:assets');
}

main().catch(function (e) {
  console.error('[scraper] FATAL: ' + (e && e.stack || e));
  process.exit(1);
});

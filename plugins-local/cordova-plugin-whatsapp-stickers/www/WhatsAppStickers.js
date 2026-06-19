var exec = require('cordova/exec');

/**
 * Adds a sticker pack to WhatsApp (Consumer) or WhatsApp Business (w4b).
 *
 * @example
 *   WhatsAppStickers.addStickerPack({
 *     identifier: "pack1",
 *     name: "My Pack",
 *     publisher: "Me",
 *     trayImage: "stickers/pack1/tray.png",
 *     stickers: [
 *       { fileName: "1.webp", source: "stickers/pack1/1.webp", emojis: ["😀"], accessibilityText: "Sticker 1" },
 *       { fileName: "2.webp", source: "stickers/pack1/2.webp", emojis: ["😀"], accessibilityText: "Sticker 2" },
 *       { fileName: "3.webp", source: "stickers/pack1/3.webp", emojis: ["😀"], accessibilityText: "Sticker 3" }
 *     ]
 *   }, successFn, errorFn);
 *
 * @param {Object|string} album  Sticker pack object (or identifier string).
 * @param {Function} success     Success callback.
 * @param {Function} error       Error callback (receives a message string).
 *
 * Sticker sources can be: asset path ("stickers/pack1/1.webp"), base64 ("data:image/webp;base64,..."),
 * file:// URI, or content:// URI.
 *
 * Optional album fields: androidPlayStoreLink, iosAppStoreLink, publisherEmail, publisherWebsite,
 *   privacyPolicyWebsite, licenseAgreementWebsite, imageDataVersion, avoidCache, animatedStickerPack.
 * Optional sticker field: accessibilityText (max 125 chars static, 255 animated).
 */
exports.addStickerPack = function(album, success, error) {
  if (typeof album === 'string') {
    exec(arguments[2], arguments[3], 'WhatsAppStickers', 'addStickerPack', [arguments[0], arguments[1]]);
    return;
  }

  exec(success, error, 'WhatsAppStickers', 'addStickerPack', [album]);
};

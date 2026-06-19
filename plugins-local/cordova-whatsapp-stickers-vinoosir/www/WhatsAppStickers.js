/**
 * WhatsApp Stickers Cordova Plugin
 *
 * Adds a sticker pack to WhatsApp (Consumer) or WhatsApp Business (w4b).
 *
 * @example
 *   const data = {
 *     identifier: "pack1",
 *     name: "My Pack"
 *   };
 *   WhatsAppStickers.addToWhatsApp(JSON.stringify(data), successFn, errorFn);
 *
 * The sticker pack metadata and image assets are read by WhatsApp from the
 * ContentProvider, which serves assets/contents.json and assets/<identifier>/*.
 * Each sticker entry in contents.json may include an optional
 * "accessibility_text" string (max 125 chars for static, 255 for animated).
 */
module.exports = {
    addToWhatsApp: function(json, success, error) {
        cordova.exec(
            success,
            error,
            'WhatsAppStickers',
            'addToWhatsApp',
            [json]
        );
    }
};

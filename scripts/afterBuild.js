module.exports = function (context) {
    const fs = require('fs');
    const path = require('path');

    const appRoot = path.join(context.opts.projectRoot, 'platforms', 'android', 'app');
    const java = path.join(appRoot, 'src', 'main', 'java');
    const admobFilePath = path.join(java, 'admob', 'plus', 'cordova', 'AdMob.java');

    // Isso corrige um bug do plugin do adMob
    if (fs.existsSync(admobFilePath)) {
        let admobFileContent = fs.readFileSync(admobFilePath, 'utf8');

        if (admobFileContent.includes('MobileAds.getVersionString')) {
            admobFileContent = admobFileContent.replace(
                /MobileAds.getVersionString/g,
                'MobileAds.getVersion',
            )
            fs.writeFileSync(admobFilePath, admobFileContent, 'utf8');
        }
    }
};
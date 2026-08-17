// const fs = require('fs');
// const path = require('path');

// module.exports = function (context) {
//   const file = path.join(
//     context.opts.projectRoot,
//     'platforms/android/CordovaLib/src/org/apache/cordova/CordovaActivity.java'
//   );
//   if (!fs.existsSync(file)) return;

//   const before = 'FrameLayout.LayoutParams webViewParams = (FrameLayout.LayoutParams) webView.getLayoutParams();';
//   const after  = 'ViewGroup.MarginLayoutParams webViewParams = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();';

//   let src = fs.readFileSync(file, 'utf8');
//   if (src.includes(before)) {
//     fs.writeFileSync(file, src.replace(before, after), 'utf8');
//     console.log('[hook] CordovaActivity.java: cast corrigido para MarginLayoutParams');
//   }
// };

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
  const file = path.join(
    context.opts.projectRoot,
    'platforms/android/CordovaLib/src/org/apache/cordova/CordovaActivity.java'
  );
  if (!fs.existsSync(file)) return;

  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('insetTarget')) return; // já está na v2, nada a fazer

  const patchedCast = `View insetTarget = webView;
            while (insetTarget.getParent() instanceof View && insetTarget.getParent() != v) {
                insetTarget = (View) insetTarget.getParent();
            }
            ViewGroup.MarginLayoutParams webViewParams =
                    (ViewGroup.MarginLayoutParams) insetTarget.getLayoutParams();`;

  const originais = [
    // arquivo original do cordova-android 15.1.0
    'FrameLayout.LayoutParams webViewParams = (FrameLayout.LayoutParams) webView.getLayoutParams();',
    // arquivo já alterado pela primeira versão do hook
    'ViewGroup.MarginLayoutParams webViewParams = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();'
  ];

  let aplicado = false;
  for (const o of originais) {
    if (src.includes(o)) {
      src = src.replace(o, patchedCast);
      aplicado = true;
      break;
    }
  }
  if (!aplicado) {
    console.warn('[hook] CordovaActivity.java: padrao nao encontrado, nada alterado');
    return;
  }

  src = src.replace(
    'webView.setLayoutParams(webViewParams);',
    'insetTarget.setLayoutParams(webViewParams);'
  );

  fs.writeFileSync(file, src, 'utf8');
  console.log('[hook] CordovaActivity.java: insets aplicados no filho direto do root (v2)');
};
var RawSource = require('webpack-sources').RawSource;

function HarmonyPlugin(options) {
  this.options = options || {};
}

HarmonyPlugin.prototype.apply = function(compiler) {
  var options = this.options;
  var jsregex = options.test || /\.js($|\?)/i;

  compiler.plugin('compilation', function (compilation) {
    compilation.plugin('optimize-chunk-assets', function (chunks, callback) {
      const files = [];

      chunks.forEach(function(chunk) {
        chunk.files.forEach(function(file) {
          files.push(file);
        });
      });

      compilation.additionalChunkAssets.forEach(function(file) {
        files.push(file);
      });

      files.filter(function(file) {
        return jsregex.test(file);
      }).forEach(function(file) {
        try {
          var asset = compilation.assets[file];

          // return cached version
          if (asset.__es3harmonyapplied) {
            compilation.assets[file] = asset.__es3harmonyapplied;
            return;
          }

          // grab source input
          var input = asset.source();

          // replace define and requires
          var result = input.replace(/__webpack_require__\.d.*{([\s\S])+?};/, '__webpack_require__.d = function(exports, name, getter) { exports[name] = getter; }')
                            .replace(/(___default\.[a-z0-9]+)/gi, '$1()')
                            .replace(/\/\* harmony default export \*\/ __webpack_exports__\["(.*)"\] = (.*?);/g, '/* harmony default export */ __webpack_require__.d(__webpack_exports__, "$1", function() { return $2; });')
                            .replace(/(__WEBPACK_IMPORTED_MODULE.*?\[".*?".*?\/\.*?\*.*?\*\/\]?)/g, '($1())')
                            .replace(/Object\.defineProperty\(__webpack_exports__, "__esModule", { value: true }\)/g, '__webpack_exports__.__esModule = true');

          // support custom regs here
          if (options && options.customReplacers instanceof Array) {
            options.customReplacers.forEach(function(replacer) {
              result = result.replace(replacer.reg, replacer.value);
            });
          }

          // save result
          asset.__es3harmonyapplied = compilation.assets[file] = new RawSource(result);
        } catch(e) {
          compilation.errors.push(e);
        }
      });

      callback();
    });
  });
};

module.exports = HarmonyPlugin;

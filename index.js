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

          /* global require */
          var replacers = require('./replacers.js');

          // perform replacements
          var result = input;
          for (var i = 0; i < replacers.length; i++) {
            var replacer = replacers[i];
            result = result.replace(replacer.reg, replacer.val);
          }

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

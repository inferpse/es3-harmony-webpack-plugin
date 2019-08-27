const { ReplaceSource } = require('webpack-sources');

class ES3HarmonyPlugin {
  constructor(options) {
    this.options = Object.assign({
      customReplacers: null,
      customHeadReplacers: null
    }, options);
  }
  apply(compiler) {
    compiler.hooks.compilation.tap('ES3HarmonyPlugin', compilation => {

      compilation.mainTemplate.hooks.beforeStartup.tap('ES3HarmonyPlugin', source => {
        return source.replace(
          /var oldJsonpFunction = jsonpArray\.push\.bind\(jsonpArray\);/,
          'var oldPushMethod = jsonpArray.push;\n' +
          'var oldJsonpFunction = function(){ return oldPushMethod.apply(jsonpArray, arguments) };'
        );
      });

      compilation.mainTemplate.hooks.requireExtensions.tap('ES3HarmonyPlugin', source => {
        const { customHeadReplacers } = this.options;

        source = source
          .replace(
            /__webpack_require__\.r =.*{[\s\S]+?};/,
            '__webpack_require__.r = function(exports) { exports.__esModule = true }'
          )
          .replace(
            /__webpack_require__\.d =.*{[\s\S]+?};/,
            '__webpack_require__.d = function(exports, name, getter) { if(!__webpack_require__.o(exports, name)) exports[name] = getter };'
          )
          .replace(
            /(__webpack_require__\((.+)?\)(\.|\[).*);/g,
            '$1();'
          )

          // webpack 4.39.2 fixes
          .replace(
            /\bdocument\.head\./gm,
            "document.querySelector('head')."
          )
          .replace(
            'var ns = Object.create(null);',
            'var ns = {};'
          )
          .replace(
            "Object.defineProperty(ns, 'default', { enumerable: true, value: value });",
            "ns['default'] = value;"
          )
          .replace(
            "__webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key)",
            "(function (key) { __webpack_require__.d(ns, key, function() { return value[key]; }) }(key)"
          );

        // add support for custom head replacers
        if (customHeadReplacers) {
          customHeadReplacers.forEach(replacer => {
            source = source.replace(replacer.reg, replacer.value);
          });
        }

        return source;
      });

      compilation.moduleTemplates.javascript.hooks.module.tap('ES3HarmonyPlugin', source => {
        const { options, replaceInSource } = this;

        // initialize replace source decorator
        source = new ReplaceSource(source);
        const origSource = source.source();

        // avoid using "bind" in ES3 environment
        replaceInSource(origSource, source, /__webpack_require__\.bind\(null, (.*?)\)/g, match => `function(){ return __webpack_require__(${match[1]}) }`);
        replaceInSource(origSource, source, /__webpack_require__\.t\.bind\(null, (.*?)\)/g, match => `function(){ return __webpack_require__.t(${match[1]}) }`);

        // explicitly invoke getter function in the places where it's used
        replaceInSource(origSource, source, /([a-z0-9_]*?__WEBPACK_IMPORTED_MODULE.*?\[(?:\/\*.*?\*\/)*?\s?".*?"\])/gi, match => `(${match[0]}())`);

        // replace default export with getter
        replaceInSource(origSource, source, /\/\* harmony default export \*\/ __webpack_exports__\["(.*)"\] = (.*?);/g, match => `/* harmony default export */ __webpack_require__.d(__webpack_exports__, "${match[1]}", function() { return ${match[2]}; });`);

        // invoke getters on default assignments
        replaceInSource(origSource, source, /(= module\['default'\])/g, match => `${match[1]}()`);

        // replace Object.keys with plain loop
        replaceInSource(origSource, source, /return Object\.keys\(map\);/g, () => `return (function() { var r = []; for (var p in map) { if (map.hasOwnProperty(p)) { r.push(p); } } return r; }())`);

        // fix internal getters (in source modules as well)
        replaceInSource(origSource, source, /(__webpack_require__\((.+)?\)(\.|\[).*);/g, match => `${match[1]}();`);

        // ModuleConcatenationPlugin fixes:
        replaceInSource(origSource, source, /\/\* harmony default export \*\/ var (.+?) = __webpack_exports__\["(.*)"\] = (.*?);/g, match => `/* harmony default export */ var ${match[1]} = ${match[3]}; __webpack_require__.d(__webpack_exports__, "${match[2]}", function() { return ${match[3]}; });`);
        replaceInSource(origSource, source, /(\w[a-z0-9_]+)\.([a-z]+)/g, (match) => { return match.input.indexOf(`${match[1]} = /*#__PURE__*/`) > -1 ? `${match[0]}()` : null });
        replaceInSource(origSource, source, /([a-z0-9_]+)\[".*?"(\s?\/.*?\/)?\]/g, (match) => {
          const isInlinedModule = new RegExp(`// EXTERNAL MODULE.*\r?\nvar ${match[1]} =`, 'g').test(match.input);
          return isInlinedModule ? `(${match[0]}())` : null
        });

        // add support for custom replacers
        if (options.customReplacers) {
          options.customReplacers.forEach(replacer => {
            replaceInSource(origSource, source, replacer.reg, replacer.value);
          });
        }

        return source;
      });

    });
  }
  replaceInSource(origSource, source, regex, replacement) {
    if (regex.test(origSource)) {
      let match;
      regex.lastIndex = 0;
      while (match = regex.exec(origSource)) {
        const oldStatement = match[0],
              newStatement = replacement(match);

        if (newStatement !== null) {
          source.replace(match.index, match.index + oldStatement.length - 1, newStatement);
        }

        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }
  }
}

module.exports = ES3HarmonyPlugin;

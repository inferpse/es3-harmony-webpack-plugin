const { ReplaceSource } = require('webpack-sources');

class ES3HarmonyPlugin {
  constructor(options) {
    this.options = Object.assign({
      customReplacers: null
    }, options);
  }
  apply(compiler) {
    compiler.plugin('compilation', compilation => {
      // perform mainTemplate replacements required to enable ES3 support
      compilation.mainTemplate.plugin('require-extensions', source => {
        return fixRequireExtensions(source);
      });

      // fix generated module code according to replacements in mainTemplate
      compilation.moduleTemplate.plugin('module', module => {
        return fixModuleCode(module, this.options);
      });

      // invoke internal getters in main template if needed
      compilation.mainTemplate.plugin('require-ensure', source => {
        return fixInternalGetters(source);
      });
    });
  }
}

/**
 * Replace __webpack_require__.d with function that will require explicit getter invocation
 */
const fixRequireExtensions = (source) => {
  return source.replace(
    /__webpack_require__\.d =.*{[\s\S]+?};/,
    `__webpack_require__.d = function(exports, name, getter) { if(!__webpack_require__.o(exports, name)) exports[name] = getter };`
  );
}

/**
 * Replace internal getters (if any introduced by 3rd party plugins)
 */
const fixInternalGetters = (source) => {
  return source.replace(/(__webpack_require__\([0-9]+\)\..*);/g, '$1();');
}

/**
 * Replace special module identifiers (__esModule)
 */
const fixModuleCode = (source, options) => {
  // initialize shared variables
  source = new ReplaceSource(source);
  const origSource = source.source();

  // replace "Object.defineProperty(__webpack_exports__, "__esModule", { value: true })" with simple "__webpack_exports__.__esModule = true"
  replaceInSource(origSource, source, /Object\.defineProperty\((.*?), "__esModule", { value: true }\);/g, match => `${match[1]}.__esModule = true;`);

  // explicitly invoke getter function in the places where it's used
  replaceInSource(origSource, source, /([a-z0-9_]*?__WEBPACK_IMPORTED_MODULE.*?\[".*?"(?:.*?\/\.*?\*.*?\*\/)*?\])/gi, match => `(${match[0]}())`);

  // avoid using "bind" in ES3 environment
  replaceInSource(origSource, source, /__webpack_require__\.bind\(null, (.*?)\)/g, match => `function(){ return __webpack_require__(${match[1]}) }`);

  // replace default export with getter
  replaceInSource(origSource, source, /\/\* harmony default export \*\/ __webpack_exports__\["(.*)"\] = (.*?);/g, match => `/* harmony default export */ __webpack_require__.d(__webpack_exports__, "${match[1]}", function() { return ${match[2]}; });`);

  // invoke getters on default imports
  replaceInSource(origSource, source, /(___default\.[a-z0-9]+)/gi, match => `${match[1]}()`);

  // invoke getters on default assignments
  replaceInSource(origSource, source, /(= module\['default'\])/g, match => `${match[1]}()`);

  // replace things related to promises and code splitting
  replaceInSource(origSource, source, /(Promise\.all\(ids\.slice\(1\)\.map\(__webpack_require__\.e\)\))/g, () => `Promise.all(function(){ var r = ids.slice(1); for(var i = 0; i < r.length; i++) { r[i] = __webpack_require__.e(r[i]); } return r; }())`);

  // replace Object.keys with plain loop
  replaceInSource(origSource, source, /return Object\.keys\(map\);/g, () => `return (function() { var r = []; for (var p in map) { if (map.hasOwnProperty(p)) { r.push(p); } } return r; }())`);

  // fix internal getters (in source modules as well)
  replaceInSource(origSource, source, /(__webpack_require__\([0-9]+\)\..*);/g, match => `${match[1]}();`);

  // fix star imports + getters
  replaceInSource(origSource, source, /=.*(__WEBPACK_IMPORTED_MODULE_[0-9_a-z]+)($|;)/gmi, match => `= (function(){ var result = {}; for (var prop in ${match[1]}) { if(${match[1]}.hasOwnProperty(prop) && typeof ${match[1]}[prop] === "function") result[prop] = ${match[1]}[prop](); }  return result; }());`);

  // replace default export with getter (when ModuleConcatenationPlugin is active)
  replaceInSource(origSource, source, /\/\* harmony default export \*\/ var (.+?) = __webpack_exports__\["(.*)"\] = (.*?);/g, match => `/* harmony default export */ var ${match[1]} = ${match[3]}; __webpack_require__.d(__webpack_exports__, "${match[2]}", function() { return ${match[3]}; });`);

  // invoke getters on default imports (when ModuleConcatenationPlugin is active)
  replaceInSource(origSource, source, /[a-z0-9$_]+\[".*?" \/\*.*?\*\/\](?!\(\)\))/gi, (match) => { return match[0].indexOf('WEBPACK_IMPORTED_MODULE') > -1 ? null : `(${match[0]}())` });

  // add support for custom replacers
  if (options.customReplacers) {
    options.customReplacers.forEach(replacer => {
      replaceInSource(origSource, source, replacer.reg, replacer.value);
    });
  }

  return source;
}

/**
 * Helper function which handles replacements in the module source
 */
const replaceInSource = (origSource, source, regex, replacement) => {
  if (regex.test(origSource)) {
    let match;
    regex.lastIndex = 0;
    while (match = regex.exec(origSource)) {  // eslint-disable-line
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

module.exports = ES3HarmonyPlugin;
/* global module require */

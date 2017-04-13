module.exports = [
  // create regular function instead of getter
  {
    reg: /__webpack_require__\.d =.*{([\s\S])+?};/,
    val: '__webpack_require__.d = function(exports, name, getter) { exports[name] = getter; }'
  },

  // invoke our "getter function" manually
  {
    reg: /(___default\.[a-z0-9]+)/gi,
    val: '$1()'
  },
  {
    reg: /(= module\['default'\])/g,
    val: '$1()'
  },
  {
    reg: /(__WEBPACK_IMPORTED_MODULE.*?\[".*?"(?:.*?\/\.*?\*.*?\*\/)*?\])/g,
    val: '($1())'
  },

  // make exports also using getters
  {
    reg: /\/\* harmony default export \*\/ __webpack_exports__\["(.*)"\] = (.*?);/g,
    val: '/* harmony default export */ __webpack_require__.d(__webpack_exports__, "$1", function() { return $2; });'
  },
  {
    reg: /Object\.defineProperty\(__webpack_exports__, "__esModule", { value: true }\)/g,
    val: '__webpack_exports__.__esModule = true'
  },

  // misc replacements to make code ES3 compatible
  {
    reg: /__webpack_require__\.bind\(null, (.*?)\)/g,
    val: 'function(){ return __webpack_require__($1) }'
  },

  // things related to promises and code splitting
  {
    reg: /(Promise\.all\(ids\.slice\(1\)\.map\(__webpack_require__\.e\)\))/g,
    val: 'Promise.all(function(){ var r = ids.slice(1); for(var i = 0; i < r.length; i++) { r[i] = __webpack_require__.e(r[i]); } return r; }())'
  },
  {
    reg: /return Object\.keys\(map\);/g,
    val: 'return (function() { var r = []; for (var p in map) { if (map.hasOwnProperty(p)) { r.push(p); } } return r; }())'
  },
  {
    reg: /(var Promise = __webpack_require__\(.*?\)\..*);/g,
    val: '$1();'
  }
];

const { SourceMapSource, RawSource } = require('webpack-sources'),
      babel = require('babel-core');

class ES3HarmonyPlugin {
  constructor(options) {
    this.options = Object.assign({
      jsregex: /\.js($|\?)/i
    }, options);
  }
  apply(compiler) {
    const { options } = this,
          { jsregex } = options,
          useSourceMap = typeof options.sourceMap === 'undefined' ? !!compiler.options.devtool : options.sourceMap;

    compiler.plugin('compilation', function (compilation) {

      if (useSourceMap) {
        compilation.plugin('build-module', function (module) {
          module.useSourceMap = true;
        });
      }

      compilation.plugin('optimize-chunk-assets', function (chunks, callback) {
        const files = [];

        chunks.forEach(chunk => {
          chunk.files.forEach(file => files.push(file));
        });

        compilation.additionalChunkAssets.forEach(file => files.push(file));

        files.filter(file => jsregex.test(file)).forEach(file => {
          try {
            let asset = compilation.assets[file];

            // use cached asset
            if (asset.__es3harmonyapplied) {
              compilation.assets[file] = asset.__es3harmonyapplied;
              return;
            }

            // read options
            let input, inputSourceMap;
            if (useSourceMap) {
              if (asset.sourceAndMap) {
                let sourceAndMap = asset.sourceAndMap();
                inputSourceMap = sourceAndMap.map;
                input = sourceAndMap.source;
              } else {
                inputSourceMap = asset.map();
                input = asset.source();
              }
            } else {
              input = asset.source();
            }

            // apply transformation
            const result = babel.transform(input, {
              plugins: [
                [TransformWebpackHelpers, options]
              ],
              sourceMaps: useSourceMap,
              compact: false,
              babelrc: false,
              inputSourceMap
            });

            // save result
            asset.__es3harmonyapplied = compilation.assets[file] = (
              result.map
              ? new SourceMapSource(result.code, file, result.map, input, inputSourceMap)
              : new RawSource(result.code)
            );
          } catch (e) {
            compilation.errors.push(e);
          }
        });

        callback();
      })
    });
  }
}

const TransformWebpackHelpers = ({types: t}) => {
  return {
    visitor: {
      Identifier: (path, {opts: options}) => {
        if (isESModuleDefiner(path)) {
          // Step 1: replace special module identifiers (stop using "Object.create")
          replaceESModuleDefiner(path);
        } else if (isModulePropDefiner(path)) {
          // Step 2: replace getter installation method for module properties with plain function
          replaceModulePropDefiner(path);
        } else if (isDefaultExport(path)) {
          // Step 3: replace default exports with getter
          wrapDefaultExport(path);
        } else if (isImportExpression(path)) {
          // Step 4: invoke getter function manually in transformed import statements
          invokeImportGetter(path);
        } else if (isInternalGetter(path)) {
          // Step 5: replace internal getters (if any introduced by 3rd party plugins)
          fixInternalGetter(path);
        } else if (isInternalBind(path)) {
          // Step 6: replace internal .bind() (ES5)
          fixInternalBind(path);
        } else if (isObjectKeys(path)) {
          // Step 7: replace internal Object.keys() (ES5)
          replaceObjectKeys(path);
        } else if (isSliceMap(path)) {
          // Step 8: replace internal ids.slice().map(...) (ES5)
          fixSliceMap(path);
        } else if (isModuleDefaultAssign(path)) {
          // Step 9: replace internal module default assign with getter invocation;
          replaceDefaultAssign(path);
        } else if (isStarImport(path)) {
          // Step 10: fix star imports
          fixStarImport(path);
        } else if (typeof options.customVisitor === 'function') {
          // Support custom visitor defined in plugin options
          options.customVisitor(path, t);
        }
      }
    }
  };

  // replace "Object.defineProperty(__webpack_exports__, "__esModule", { value: true })" with "__webpack_exports__.__esModule = true"
  function isESModuleDefiner(path) {
    const { node, parentPath } = path;
    if (
      node.name === 'defineProperty'
        && parentPath.isMemberExpression()
        && parentPath.get('object').node.name === 'Object'
    ) {
      const args = parentPath.parentPath.get('arguments');
      return args.length === 3
            && args[0].isIdentifier()
            && args[1].isStringLiteral()
            && args[0].node.name === '__webpack_exports__'
            && args[1].node.value === '__esModule'
    }
  }
  function replaceESModuleDefiner(path) {
    const { parentPath } = path;
    parentPath.parentPath.replaceWithSourceString('__webpack_exports__.__esModule = true');
  }

  // replace "__webpack_require__.d = function(exports, name, getter) { Object.defineProperty... }" with "__webpack_require__.d = function(exports, name, getter) { exports[name] = getter; }"
  function isModulePropDefiner(path) {
    const { node, parentPath } = path;
    return node.name === 'd'
          && parentPath.isMemberExpression()
          && parentPath.parentPath.isAssignmentExpression()
          && parentPath.get('object').node.name === '__webpack_require__'
          && parentPath.parentPath.getSource().indexOf('Object.defineProperty') > -1;
  }
  function replaceModulePropDefiner(path) {
    const { parentPath } = path,
          assignmentPath = parentPath.parentPath;

    assignmentPath.replaceWithSourceString(`
      __webpack_require__.d = function(exports, name, getter) {
        if (!__webpack_require__.o(exports, name)) {
          exports[name] = getter;
        }
      }
    `);
  }

  // replace default exports "__webpack_exports__["c"] = parseTemplate" with "__webpack_require__.d(__webpack_exports__, "c", function() { return parseTemplate; })"
  function isDefaultExport(path) {
    const { node, parentPath } = path;
    return node.name === '__webpack_exports__'
          && parentPath.isMemberExpression()
          && parentPath.node.computed
          && parentPath.parentPath.isAssignmentExpression();
  }
  function wrapDefaultExport(path) {
    const { parentPath } = path,
          assignmentPath = parentPath.parentPath,
          propName = parentPath.get('property').node.value,
          propValue = assignmentPath.get('right').getSource();

    assignmentPath.replaceWithSourceString(`__webpack_require__.d(__webpack_exports__, "${propName}", function() { return ${propValue}; })`);
  }

  // replace "__WEBPACK_IMPORTED_MODULE...['с']" with "(__WEBPACK_IMPORTED_MODULE...['с']())"
  function isImportExpression(path) {
    const { node, parentPath } = path,
          callPath = parentPath.parentPath;

    return node.name.indexOf('__WEBPACK_IMPORTED_MODULE') > -1
          && parentPath.isMemberExpression()
          && (!callPath.isCallExpression() || (callPath.isCallExpression() && callPath.get('callee').get('object').node !== node));
  }
  function invokeImportGetter(path) {
    const { parentPath } = path;
    parentPath.replaceWith(t.callExpression(parentPath.node, []));
  }

  // replace "__webpack_require__(0).a" with "__webpack_require__(0).a()"
  function isInternalGetter(path) {
    const { node, parentPath } = path;
    return node.name === '__webpack_require__'
          && parentPath.isCallExpression()
          && parentPath.parentPath.isMemberExpression()
          && !parentPath.parentPath.parentPath.isCallExpression();
  }
  function fixInternalGetter(path) {
    const { parentPath } = path,
          memberExpressionPath = parentPath.parentPath;

    memberExpressionPath.replaceWith(
      t.callExpression(memberExpressionPath.node, [])
    )
  }

  // replace "__webpack_require__.bind(null, 11)" with "function(){ return __webpack_require__(11, 22, 33) }"
  function isInternalBind(path) {
    const { node, parentPath } = path;
    return node.name === 'bind'
          && parentPath.isMemberExpression()
          && parentPath.get('object').node.name === '__webpack_require__';
  }
  function fixInternalBind(path) {
    const { parentPath } = path,
          internalBindPath = parentPath.parentPath;

    internalBindPath.replaceWith(
      t.functionExpression(null, [],
        t.blockStatement([
          t.returnStatement(
            t.callExpression(t.identifier('__webpack_require__'), internalBindPath.node.arguments.slice(1))
          )
        ])
      )
    );
  }

  // replace Object.keys() with plain loop
  function isObjectKeys(path) {
    const { node, parentPath } = path;
    return node.name === 'keys'
          && parentPath.isMemberExpression()
          && parentPath.get('object').node.name === 'Object';
  }
  function replaceObjectKeys(path) {
    const { parentPath } = path;
    parentPath.replaceWithSourceString('(function() { var r = []; for (var p in map) { if (map.hasOwnProperty(p)) { r.push(p); } } return r; }())');
  }

  // replace "Promise.all(ids.slice(1).map(...))" with plain function
  function isSliceMap(path) {
    const { node, parentPath } = path,
          callPath = parentPath.parentPath;

    return node.name === 'ids'
          && parentPath.isMemberExpression()
          && callPath.isCallExpression()
          && parentPath.get('property').node.name === 'slice'
          && callPath.parentPath.isMemberExpression()
          && callPath.parentPath.get('property').node.name === 'map'
  }
  function fixSliceMap(path) {
    const { parentPath } = path,
          callPath = parentPath.parentPath,
          mapPath = callPath.parentPath.parentPath,
          sliceIndex = callPath.get('arguments')[0].node.value;

    mapPath.replaceWithSourceString(`(function(){
      var r = ids.slice(${sliceIndex});
      for(var i = 0; i < r.length; i++) {
        r[i] = __webpack_require__.e(r[i]);
      }
      return r;
    }())`);
  }

  // replace internal "xxx = module.default" with "xxx = module.default()";
  function isModuleDefaultAssign(path) {
    const { node, parentPath } = path;
    return node.name === 'module'
        && parentPath.isMemberExpression()
        && parentPath.get('property').node.value === 'default'
        && !parentPath.parentPath.isCallExpression()
        && !parentPath.parentPath.isReturnStatement()
  }
  function replaceDefaultAssign(path) {
    const { parentPath } = path;
    parentPath.replaceWith(t.callExpression(parentPath.node, []));
  }

  // invoke all getters in star import (invoke all getters in identifier)
  function isStarImport(path) {
    const { node, parentPath } = path;
    return node.name.indexOf('__WEBPACK_IMPORTED_MODULE_') > -1
        && parentPath.isAssignmentExpression()
        && parentPath.get('right').node.name === node.name;
  }
  function fixStarImport(path) {
    const { node } = path;
    path.replaceWith(t.expressionStatement(
      t.callExpression(
        t.functionExpression(null, [t.identifier('obj')], t.blockStatement([
          t.variableDeclaration('var', [t.variableDeclarator(t.identifier('result'), t.objectExpression([]))]),
          t.forInStatement(
            t.variableDeclaration('var', [t.variableDeclarator(t.identifier('prop'))]),
            t.identifier('obj'),
            t.blockStatement([
              t.ifStatement(
                t.logicalExpression(
                  '&&',
                  t.callExpression(t.memberExpression(t.identifier('obj'), t.identifier('hasOwnProperty')), [t.identifier('prop')]),
                  t.binaryExpression('===', t.unaryExpression('typeof', t.memberExpression(t.identifier('obj'), t.identifier('prop'), true)), t.stringLiteral('function'))
                ),
                t.expressionStatement(
                  t.assignmentExpression('=',
                    t.memberExpression(t.identifier('result'), t.identifier('prop'), true),
                    t.callExpression(t.memberExpression(t.identifier('obj'), t.identifier('prop'), true), [])
                  )
                )
              )
            ])
          ),
          t.returnStatement(t.identifier('result'))
        ])), [node]
      )
    ));
  }
}

module.exports = ES3HarmonyPlugin;

var loaderUtils = require("loader-utils");
var validateOptions = require("schema-utils");
var Vibrant = require("node-vibrant");
var potrace = require("potrace");
var SVGO = require("svgo");
var schema = require("./options.json");
var Potrace = potrace.Potrace;

var fs = require('fs')
var path = require( 'path' );

// https://codepen.io/tigt/post/optimizing-svgs-in-data-uris
function encodeSvgDataUri(svg) {
  var uriPayload = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%20/g, " ")
    .replace(/%3D/g, "=")
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/")
    .replace(/%22/g, "'");

  return "data:image/svg+xml," + uriPayload;
}

function optimizeSvg(svg) {
  return new Promise(function(resolve) {
    var svgo = new SVGO({ multipass: true, floatPrecision: 0 });

    svgo.optimize(svg, function(result) {
      resolve(result.data);
    });
  });
}

function extractMostProminentColor(filePath) {
  var vibrant = new Vibrant(filePath);

  return vibrant.getPalette().then(function(palette) {
    var mostProminentColor = "";
    var highestPopulation = 0;
    var color = "";
    var population = 0;

    Object.keys(palette).forEach(function(key) {
      if (palette[key] === null) {
        return;
      }
      
      color = palette[key].getHex();
      population = palette[key].getPopulation();

      if (population > highestPopulation) {
        mostProminentColor = color;
        highestPopulation = population;
      }
    });

    return mostProminentColor;
  });
}

function traceSvg(filePath, traceParams) {
  return new Promise(function(resolve, reject) {
    var trace = new Potrace(traceParams);

    trace.loadImage(filePath, function(error) {
      if (error) {
        reject(error);
      } else {
        resolve(trace.getSVG());
      }
    });
  });
}

module.exports = function(contentBuffer) {
  if (this.cacheable) {
    this.cacheable();
  }

  var options = loaderUtils.getOptions(this) || {};

  validateOptions(schema, options, "Image Trace Loader");

  var content = contentBuffer.toString("utf8");
  var filePath = this.resourcePath;
  var contentIsUrlExport = /^export default "data:(.*)base64,(.*)/.test(content);
  var contentIsFileExport = /^export default (.*)/.test(content);
  var src = "";

  if (contentIsUrlExport) {
    src = content.match(/^export default (.*)/)[1];
    if (options.skipTraceIfBase64) {
      return 'module.exports = { "src": ' + src + ', "trace": "" };';
    }
  } else {
    if (!contentIsFileExport) {
      var fileLoader = require("file-loader");
      content = fileLoader.call(this, contentBuffer);
    }
    src = content.match(/^export default (.*);/)[1];
  }

  var callback = this.async();
  var traceParams = {
    turnPolicy: "turnPolicy" in options ? Potrace[options.turnPolicy] : Potrace.TURNPOLICY_MINORITY,
    turdSize: "turdSize" in options ? parseFloat(options.turdSize) : 100,
    alphaMax: "alphaMax" in options ? parseFloat(options.alphaMax) : 1,
    optCurve: "optCurve" in options ? options.optCurve : true,
    optTolerance: "optTolerance" in options ? parseFloat(options.optTolerance) : 0.2,
    threshold: "threshold" in options ? (Potrace[options.threshold] || parseFloat(options.threshold)) : Potrace.THRESHOLD_AUTO,
    blackOnWhite: "flipColors" in options ? !options.flipColors : true,
    background: "background" in options ? (Potrace[options.background] || options.background) : Potrace.COLOR_TRANSPARENT
  };

  var color = "color" in options ? (Potrace[options.color] || options.color) : Potrace.COLOR_AUTO;
  var getFillColor = Promise.resolve(color);

  if (color === Potrace.COLOR_AUTO) {
    getFillColor = extractMostProminentColor(filePath);
  }

  var emitFile = this.emitFile;

  getFillColor.then(function(color) {
    traceParams.color = color;
    return traceSvg(filePath, traceParams);
  })
  .then(optimizeSvg)
  .then(encodeSvgDataUri)
  .then(function(encodedSvgDataUri) {

    const url = src
      .replace('__webpack_public_path__ + ', '')
      .replace(/"/g,'')
    const key = url
      .replace(options.inputPath, '')

    const data = {
      [key]: {
        src: url,
        trace: encodedSvgDataUri
      }
    }

    const output = options.outputPath + options.file
    let input = '{}'
    let jsonfile = `${process.cwd()}${
      options.publicPath ? `/${options.publicPath}/` : '/'
    }${output}`

    try { 
      input = fs.readFileSync(jsonfile, 'utf8')
    } catch(error) {
      console.log(`File ${input} not found. Create new file`)
    }

    var json = JSON.parse(input)
    json = Object.assign({}, json, data)
    fs.writeFileSync(jsonfile, JSON.stringify(json))

    callback(null, `module.exports = ${src};`);
    // emitFile && emitFile(`${options.outputPath}${key}.json`, JSON.stringify(data));
    // callback(null, 'module.exports = { "src": ' + src + ' , "trace": "' + encodedSvgDataUri + '" };');
  })
  .catch(function(error) {
    console.error(error);
    callback(error);
  });
};

module.exports.raw = true;

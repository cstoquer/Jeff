'use strict';
var Canvas         = require('canvas');
var CanvasRenderer = require('./main');

CanvasRenderer.prototype._getMaxDimensions = function (graphics) {
	var graphicsMaxDims = {};
	var classRatios     = this._classRatios || {};
	var hasFixedSize    = this._fixedSize !== undefined;

	// Updating class ratios with respect to the fixed size dimension
	if (hasFixedSize) {
		
		var classRatiosTmp = {};
		var fixedWidth     = this._fixedSize.width;
		var fixedHeight    = this._fixedSize.height;

		var width, height;
		for (var className in this._classGroupList) {
			var classId = this._classGroupList[className];
			var symbol  = this._symbols[classId];

			// TODO: get max bounds from all frames
			var bounds = symbol.bounds[0];
			if (bounds) {
				width  = bounds.right  - bounds.left;
				height = bounds.bottom - bounds.top;
			} else {
				width  = fixedWidth;
				height = fixedHeight;
			}

			classRatiosTmp[className] = (classRatios[className] ? classRatios[className] : 1) * Math.min(fixedWidth / width, fixedHeight / height);
		}
		classRatios = classRatiosTmp;
	}

	var maxDimForClass, classRatio;
	for (var id in graphics) {
		var graphic   = graphics[id];
		var maxWidth  = 0;
		var maxHeight = 0;
		var maxDims   = graphic.maxDims;
		for (var className in this._classGroupList) {

			maxDimForClass = maxDims[className];
			classRatio = classRatios[className] || 1;

			if (maxDimForClass) {
				maxWidth  = Math.max(maxWidth,  classRatio * maxDimForClass.width);
				maxHeight = Math.max(maxHeight, classRatio * maxDimForClass.height);
			}
		}

		graphicsMaxDims[id] = { width: maxWidth, height: maxHeight };
	}

	return graphicsMaxDims;
};

var MARGIN = 1;
CanvasRenderer.prototype._setGraphicDimensions = function (graphics, graphicMaxDims) {

	var graphicDims = {};
	for (var id in graphics) {
		var graphic = graphics[id];

		// Computing element dimension before scaling to ratio
		var bounds = graphic.bounds[0];

		var x, y, w, h;
		if (graphic.isImage) {
			var image = this._images[id];
			x = 0;
			y = 0;
			w = image.width;
			h = image.height;
		} else {
			x = bounds.left;
			y = bounds.top;
			w = bounds.right  - bounds.left;
			h = bounds.bottom - bounds.top;
		}

		// Computing graphic ratio for rendering
		var graphicRatio = this._ratio;

		// Reducing the size of the element if it is bigger than the maximum allowed dimension
		var graphicMaxDim = graphicMaxDims[id];
		var maxWidth  = graphicMaxDim.width;
		var maxHeight = graphicMaxDim.height;

		var graphicWidth;
		var graphicHeight;
		if (maxWidth === 0 || maxHeight === 0) {
			graphicRatio  = 0;
			graphicWidth  = 1;
			graphicHeight = 1;
		} else {
			var widthRatio   = w / maxWidth;
			var heightRatio  = h / maxHeight;

			if (widthRatio > heightRatio) {
				graphicRatio /= widthRatio;
			} else {
				graphicRatio /= heightRatio;
			}

			graphicWidth  = Math.ceil(w * graphicRatio);
			graphicHeight = Math.ceil(h * graphicRatio);

			var ratioToMaxDim = Math.sqrt((this._maxImageDim * this._maxImageDim) / (graphicWidth * graphicHeight));
			if (ratioToMaxDim < 1) {
				graphicWidth  *= ratioToMaxDim;
				graphicHeight *= ratioToMaxDim;
				graphicRatio  *= ratioToMaxDim;
			}
		}

		// Saving element position and dimension in the atlas
		graphicDims[id] = {
			x: x,
			y: y,
			w: w,
			h: h,
			sx: 0,
			sy: 0,
			sw: graphicWidth,
			sh: graphicHeight,
			dx: x * graphicRatio,
			dy: y * graphicRatio,
			ratio: graphicRatio,
			margin: MARGIN
		};
	}

	return graphicDims;
};

function getGraphicsToRender(symbols, symbolList, images) {
	var graphics = {};
	for (var idString in symbolList) {
		var symbolId = symbolList[idString];
		var symbol   = symbols[symbolId];
		if (symbol.isGraphic) {
			if (symbol.isImage) {
				var image = images[idString];
				if (!image) {
					console.warn('[CanvasRenderer.getGraphicsToRender] Graphic image not rendered', idString);
					continue;
				}
			}
			graphics[symbolId] = symbol;
		}
	}
	return graphics;
}

CanvasRenderer.prototype._renderGraphics = function (graphics, graphicDims, canvasses) {
	for (var id in graphics) {
		var canvas  = new Canvas();
		var context = canvas.getContext('2d');

		var graphic    = graphics[id];
		var dimensions = graphicDims[id];

		canvas.width  = dimensions.sw;
		canvas.height = dimensions.sh;

		if (graphic.isShape) {
			var transform = [dimensions.ratio, 0, 0, dimensions.ratio, - dimensions.dx, - dimensions.dy];
			this._drawShapes(graphic.shapes, context, transform);
		}

		if (graphic.isImage) {
			var image = this._images[id];
			if (!image) {
				continue;
			}

			context.drawImage(image, - dimensions.dx, - dimensions.dy, dimensions.sw, dimensions.sh);
		}

		canvasses[id] = canvas;
	}
};

CanvasRenderer.prototype._renderFrames = function (canvasses, graphicProperties) {
	var identityMatrix = [1, 0, 0, 1, 0, 0];
	var identityColor  = [1, 1, 1, 1, 0, 0, 0, 0];

	for (var className in this._classGroupList) {
		var classId   = this._classGroupList[className];
		var symbol    = this._symbols[classId];
		var ratio     = this._ratio;
		var fixedSize = this._fixedSize;

		if (symbol.isAnim) {
			var duration     = this._firstFrameOnly ? 1 : symbol.duration;
			var animColors   = [];
			var animMatrices = [];
			var classAnim    = { id: classId, colors: animColors, matrices: animMatrices };

			var bounds = symbol.containerBounds || symbol.bounds;
			if (!bounds) {
				continue;
			}

			for (var f = 0; f < duration; f += 1) {
				var canvas  = new Canvas();
				var context = canvas.getContext('2d');

				var frameBounds = bounds[f];
				if (!frameBounds) {
					continue;
				}

				var x = frameBounds.left;
				var y = frameBounds.top;
				var w = frameBounds.right  - frameBounds.left;
				var h = frameBounds.bottom - frameBounds.top;

				var ratioW = ratio;
				var ratioH = ratio;
				if (fixedSize) {
					ratioW *= fixedSize.width  / w;
					ratioH *= fixedSize.height / h;
				}

				canvas.width  = Math.ceil(ratioW * w);
				canvas.height = Math.ceil(ratioH * h);

				if (canvas.width === 0 || canvas.height === 0) {
					continue;
				}

				animColors[f]   = identityColor;
				animMatrices[f] = [ratioW, 0, 0, ratioH, - ratioW * frameBounds.left, - ratioH * frameBounds.top, 1];
				this._renderSymbol(canvas, context, identityMatrix, identityColor, classAnim, f, false);

				var canvasName = this._firstFrameOnly ? symbol.className : symbol.frameNames[f];
				canvasses[canvasName] = canvas;
				graphicProperties[symbol.frameNames[f]] = {
					x: x,
					y: y,
					w: w,
					h: h,
					sx: 0,
					sy: 0,
					sw: canvas.width,
					sh: canvas.height,
					margin: 0
				};
			}
		}
	}
};

CanvasRenderer.prototype._renderImages = function (retry) {
	var imageList = [];
	var canvasses = {};
	var graphicProperties = {};

	if (this._frameByFrame) {
		this._renderFrames(canvasses, graphicProperties);
	} else {
		// 1 - Generating list of graphics to render
		var graphics = getGraphicsToRender(this._symbols, this._symbolList, this._images);

		// 2 - Computing minimum rendering size that will guarantee lossless quality for each graphic
		var graphicMaxDims = this._getMaxDimensions(graphics);

		// 3 - Computing graphic dimensions with respect to their maximum dimensions and required ratios
		graphicProperties = this._setGraphicDimensions(graphics, graphicMaxDims);

		// 4 - Rendering graphics in canvasses
		this._renderGraphics(graphics, graphicProperties, canvasses);
	}

	if (this._createAtlas) {
		var atlas = this._renderAtlas(canvasses, graphicProperties);
		if (atlas) {
			imageList = [{ img: atlas, name: 'atlas' }];
		} else {
			// Atlas could not be extracted at current ratio
			// Reducing extraction ratio and attempting rendering once more
			this._ratio *= 0.9;
			var nbRetries = retry || 0;
			return this._renderImages(nbRetries + 1);
		}

		if (retry) {
			console.warn(
				'[CanvasRenderer.renderImages] Atlas created with ratio ' + this._ratio
				+ ' because it did not fit into the required dimensions.'
				+ '(File Group ' + this._exporter._fileGroupName + ', Class ' + this._exporter._classGroupName + ')'
			);
		}
			
	} else {
		// TODO: manage case when images should be exported with power of 2 dimensions
		// if (this._powerOf2Images) {
		// 	augmentToNextPowerOf2(canvasses);
		// }
		for (var imageName in canvasses) {
			imageList.push({ name: imageName, img: canvasses[imageName] });
		}
	}


	// End of the rendering
	// All swf objects should have been correctly rendered at this point
	this._rendering = false;
	if (this._callback) {
		this._callback(imageList, graphicProperties);
	}
};
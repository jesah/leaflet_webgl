
/*
    Jerry Sahlin 2015-07-08
    A lot of code taken from Stanislav Sumbera excellent work : https://gist.github.com/Sumbera  
    
*/


L.Webgl = L.Class.extend({
        
    numPoints : 0, 
    gl : null,pixelsToWebGLMatrix : null, mapMatrix : null, program : null,u_matLoc: null,
    verts : [],

    initialize: function (userDrawFunc, options) {
        this._userDrawFunc = userDrawFunc;
        L.setOptions(this, options);
    },

    drawing: function (userDrawFunc) {
        this._userDrawFunc = userDrawFunc;
        return this;
    },

    params:function(options){
        L.setOptions(this, options);
        return this;
    },

    canvas: function () {
        return this._canvas;
    },

    redraw: function () {
        if (!this._frame) {
            this._frame = L.Util.requestAnimFrame(this._redraw, this);
        }
        return this;
    },

    getFragmentShaderSource : function() {
        var fshader = [
            'precision mediump float;',
            'varying vec4 v_color;',

            'void main() {',
            // -- squares
            'gl_FragColor = v_color;',
            'gl_FragColor.a = 0.8;',
            '}',
        ].join('\n');
        return fshader;        
    },

    getVertexShaderSource : function() {
        
        var vshader = [
            'uniform mat4 u_matrix;',
            'attribute vec4 a_vertex;',
            'attribute float a_pointSize;',
            'attribute vec4 a_color;',
            'varying vec4 v_color;',

            'void main() {',
            // Set the size of the point
            'gl_PointSize =  a_pointSize;',

            // multiply each vertex by a matrix.
            'gl_Position = u_matrix * a_vertex;',

            // pass the color to the fragment shader
            'v_color = a_color;',
            '}'
        ].join('\n');
        return vshader;
    },
    
  
    onAdd: function (map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');

        var size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        var animated = this._map.options.zoomAnimation && L.Browser.any3d;
        L.DomUtil.addClass(this._canvas, 'leaflet-zoom-' + (animated ? 'animated' : 'hide'));


        map._panes.overlayPane.appendChild(this._canvas);

        map.on('moveend', this._reset, this);
        map.on('resize',  this._resize, this);

        if (map.options.zoomAnimation && L.Browser.any3d) {
            map.on('zoomanim', this._animateZoom, this);
        }
       
        this._reset();
        this.drawing(this.drawingOnCanvas);
        this.initWebgl(); 
    },

    onRemove: function (map) {
        map.getPanes().overlayPane.removeChild(this._canvas);
 
        map.off('moveend', this._reset, this);
        map.off('resize', this._resize, this);

        if (map.options.zoomAnimation) {
            map.off('zoomanim', this._animateZoom, this);
        }
        this._canvas = null;

    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    _resize: function (resizeEvent) {
        this._canvas.width  = resizeEvent.newSize.x;
        this._canvas.height = resizeEvent.newSize.y;
    },
    _reset: function () {
        var topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._redraw();
    },

    _redraw: function () {
        var size     = this._map.getSize();
        var bounds   = this._map.getBounds();
        var zoomScale = (size.x * 180) / (20037508.34  * (bounds.getEast() - bounds.getWest())); // resolution = 1/zoomScale
        var zoom = this._map.getZoom();

        if (this._userDrawFunc) {
            this._userDrawFunc(this,
                {
                    canvas   :this._canvas,
                    bounds   : bounds,
                    size     : size,
                    zoomScale: zoomScale,
                    zoom : zoom,
                    options: this.options
               });
        }
        
        this._frame = null;
    },

    _animateZoom: function (e) {
        var scale = this._map.getZoomScale(e.zoom),
            offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale).subtract(this._map._getMapPanePos());

        this._canvas.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')';

    },
    
   loadGeoJson : function (url){
       var self = this;
       if(typeof url === 'string' || url instanceof String) {
          var req = new XMLHttpRequest();           

          req.onreadystatechange = function() {
            if (this.readyState == 4 ) {
               if(this.status == 200){
                   self.loadData(JSON.parse(this.responseText));

               }
            }
          }

          req.open("GET", url, true);
          req.send();       
       
       } else {
            self.loadData(url);
       }

    }, 
    
    loadShapeFile : function(url) {     
        var self = this;

        shp(url).then(function(geojson){
            console.log("Shapefile loaded, processing data");
            self.loadData(geojson);
        });
 
    },    
    loadData : function(data) {
        var features = data.features;
        var self = this;
        var coords = null;

        
        for(var i = 0; i < features.length; i++){
            var feature = features[i];
            

            var type = feature.geometry.type;
                
            if(typeof type !== 'undefined'){

                switch(type) {
                    case 'Polygon' :
                        coords = feature.geometry.coordinates[0];
                        break;

                    case 'MultiPolygon' :
                        coords = feature.geometry.coordinates[0][0];             
                        break;

                    case 'Point' :
                        coords = feature.geometry.coordinates; 
                        break;


                }
                self.verts = self.verts.concat(makeVerts(coords));
            }     
          
        }        
        
        self.renderWebgl(self.verts);
    },
 
    loadWithWorkers : function (data) {
        
        var features = data.features;
        var self = this;
        var coords = null;
        var pool = new ThreadPool(features.length);
        
        pool.allDone(allDone);
        
        var workers = 0;
        
        for(var i = 0; i < features.length; i++){
            var feature = features[i];
            

            var type = feature.geometry.type;
                
            if(typeof type !== 'undefined'){

                switch(type) {
                    case 'Polygon' :
                        coords = feature.geometry.coordinates[0];
                        break;

                    case 'MultiPolygon' :
                        coords = feature.geometry.coordinates[0][0];             
                        break;

                    case 'Point' :
                        coords = feature.geometry.coordinates; 
                        break;


                }
            }
            workers++;
     
            pool
              .run("js/earcut-1.4.2.js",{'cmd': 'start', 'data': coords})
              .done(function(result) {
                workerResult(result);
              });          
          
        }
        function allDone(e) {
            self.renderWebgl(self.verts);
        }
        
        function workerResult(e) {
            workers--;
            var arr = e;
            if(self.verts.length == 0) {
                self.verts = arr;
            } else {
                self.verts = self.verts.concat(arr); 
            }
          //  if(workers == 0)
          //      self.renderWebgl(self.verts);
        } 
        
        
    },    
    

    
    sendToWorker : function(coords) {
        var self = this;
                
        var worker = new Worker('js/earcut-1.4.2.js');  
        worker.onmessage = workerDone;    
        worker.postMessage({'cmd': 'start', 'data': coords}); 
  
        
        function workerDone(e) {
            var arr = e.data;
            if(self.verts.length == 0) {
                self.verts = arr;
            } else {
                self.verts = self.verts.concat(arr); 
            }  
            self.renderWebgl(self.verts);
        }
    },
    
    /**
     * Compiles a vertex or fragment shader from the supplied source code.
     * @param {string} src
     * @param {!WebGLShader} shader
     * @return {boolean} Whether the shader compiled successfully.
     * @private
     */
    compileShader : function(src, shader) {
      this.gl.shaderSource(shader, src);
      this.gl.compileShader(shader);

      var compileStatus = this.gl.getShaderParameter(shader,
          this.gl.COMPILE_STATUS);

      return compileStatus;
    },
    
    initWebgl : function() {

        this.gl = this.canvas().getContext('experimental-webgl', { antialias: true });

        this.pixelsToWebGLMatrix = new Float32Array(16);
        this.mapMatrix = new Float32Array(16);
        
           // -- WebGl setup     
        var vertexShader = this.gl.createShader(this.gl.VERTEX_SHADER); 
        var fragmentShader = this.gl.createShader(this.gl.FRAGMENT_SHADER); 
        this.compileShader(this.getVertexShaderSource(),vertexShader);
        this.compileShader(this.getFragmentShaderSource(),fragmentShader);
        
        // link shaders to create our program
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);
        this.gl.useProgram(this.program);
    },
    
    renderWebgl : function (verts) {
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.enable(this.gl.BLEND);

        // look up the locations for the inputs to our shaders.
        this.u_matLoc = this.gl.getUniformLocation(this.program, "u_matrix");
        this.gl.aPointSize = this.gl.getAttribLocation(this.program, "a_pointSize");
        // Set the matrix to some that makes 1 unit 1 pixel.

        this.pixelsToWebGLMatrix.set([2 / this.canvas().width, 0, 0, 0, 0, -2 / this.canvas().height, 0, 0, 0, 0, 0, 0, -1, 1, 0, 1]);
        this.gl.viewport(0, 0, this.canvas().width, this.canvas().height);

        this.gl.uniformMatrix4fv(this.u_matLoc, false, this.pixelsToWebGLMatrix);        
        
        // tirangles or point count
        this.numPoints = verts.length / 5;
        console.log("Redraw layer with points:   " + this.numPoints);
        var vertBuffer = this.gl.createBuffer();
        var vertArray = new Float32Array(verts);
        var fsize = vertArray.BYTES_PER_ELEMENT;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertArray, this.gl.STATIC_DRAW);
        var vertLoc = this.gl.getAttribLocation(this.program, "a_vertex");
        this.gl.vertexAttribPointer(vertLoc, 2, this.gl.FLOAT, false, fsize * 5, 0);
        this.gl.enableVertexAttribArray(vertLoc);
        // -- offset for color buffer
        var colorLoc = this.gl.getAttribLocation(this.program, "a_color");
        this.gl.vertexAttribPointer(colorLoc, 3, this.gl.FLOAT, false, fsize * 5, fsize * 2);
        this.gl.enableVertexAttribArray(colorLoc);
        this._redraw(); 
    },
    
    drawingOnCanvas: function (canvasOverlay, params) {

        if (this.gl == null) return;

        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.pixelsToWebGLMatrix.set([2 / this.canvas().width, 0, 0, 0, 0, -2 / this.canvas().height, 0, 0, 0, 0, 0, 0, -1, 1, 0, 1]);
        this.gl.viewport(0, 0, this.canvas().width, this.canvas().height);
        
        var pointSize = Math.max(this._map.getZoom() - 4.0, 1.0);
        this.gl.vertexAttrib1f(this.gl.aPointSize, pointSize);

        // -- set base matrix to translate canvas pixel coordinates -> webgl coordinates
        this.mapMatrix.set(this.pixelsToWebGLMatrix);

        var bounds = this._map.getBounds();
        var topLeft = new L.LatLng(bounds.getNorth(), bounds.getWest());
        var offset = this.LatLongToPixelXY(topLeft.lat, topLeft.lng);

        // -- Scale to current zoom
        var scale = Math.pow(2, this._map.getZoom());
        this.scaleMatrix(this.mapMatrix, scale, scale);

        this.translateMatrix(this.mapMatrix, -offset.x, -offset.y);

        // -- attach matrix value to 'mapMatrix' uniform in shader
        this.gl.uniformMatrix4fv(this.u_matLoc, false, this.mapMatrix);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, this.numPoints);

    },

    // Returns a random integer from 0 to range - 1.
    randomInt: function (range) {
        return Math.floor(Math.random() * range);
    },

      
    // -- converts latlon to pixels at zoom level 0 (for 256x256 tile size) , inverts y coord )
    // -- source : http://build-failed.blogspot.cz/2013/02/displaying-webgl-data-on-google-maps.html

    LatLongToPixelXY: function (latitude, longitude) {
        var pi_180 = Math.PI / 180.0;
        var pi_4 = Math.PI * 4;
        var sinLatitude = Math.sin(latitude * pi_180);
        var pixelY = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (pi_4)) * 256;
        var pixelX = ((longitude + 180) / 360) * 256;

        var pixel = { x: pixelX, y: pixelY };

        return pixel;
    },

    translateMatrix: function (matrix, tx, ty) {
        // translation is in last column of matrix
        matrix[12] += matrix[0] * tx + matrix[4] * ty;
        matrix[13] += matrix[1] * tx + matrix[5] * ty;
        matrix[14] += matrix[2] * tx + matrix[6] * ty;
        matrix[15] += matrix[3] * tx + matrix[7] * ty;
    },

    scaleMatrix: function (matrix, scaleX, scaleY) {
        // scaling x and y, which is just scaling first two columns of matrix
        matrix[0] *= scaleX;
        matrix[1] *= scaleX;
        matrix[2] *= scaleX;
        matrix[3] *= scaleX;

        matrix[4] *= scaleY;
        matrix[5] *= scaleY;
        matrix[6] *= scaleY;
        matrix[7] *= scaleY;
    }

});


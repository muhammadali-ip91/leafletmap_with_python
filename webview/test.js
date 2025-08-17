// Define base layers FIRST
var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
});
var opentopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
});
var topo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri'
});

// Now initialize the map with the default base layer
var map = L.map('map', {
    zoomControl: false,
    layers: [streets]
}).setView([33.9991, 72.9341], 13);

// Add zoom control at bottom right
L.control.zoom({ position: 'topright' }).addTo(map);

// Add layer control at top right (with draw controls)
var baseLayers = {
    "Streets": streets,
    "Satellite": satellite,
    "OpenTopo": opentopo,
    "Topo": topo
};
L.control.layers(baseLayers, null, { position: 'bottomright' }).addTo(map);

// Feature group for drawn items
var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Add geocoder (search bar)
L.Control.geocoder({
    defaultMarkGeocode: true,
    geocoder: L.Control.Geocoder.nominatim()
}).addTo(map);

// Add drawing controls
var drawControl = new L.Control.Draw({
    position: 'topright',
    edit: { featureGroup: drawnItems },
    draw: {
        polygon: true,
        polyline:true,
        rectangle: true,
        circle: true,
        marker: true,
        circlemarker: false
    }
});
map.addControl(drawControl);

// ===== Modern Combined Graph (Elevation + Distance) =====
const modernGraph = {
    container: null, canvas: null, ctx: null,
    visible: false, activeLine: null,
    // data (lengthSamples retained but unused now)
    lengthSamples: [], maxSamples: 120,
    dists: [], elevs: [], statusText: '',

    init() {
        if (this.container) return;
        const el = document.createElement('div');
        el.style.cssText = `
            position:absolute; left:10px; bottom:10px;
            width:380px; background:rgba(18,16,29,0.9);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:14px; padding:10px 10px 12px;
                z-index:1000; display:none; box-shadow:0 8px 24px rgba(0,0,0,0.25);
                backdrop-filter: blur(4px); pointer-events:auto; color:#eaeaf2; font:12px/1.3 system-ui,Segoe UI,Arial;
        `;
        const title = document.createElement('div');
        title.textContent = 'Line metrics';
        title.style.cssText = 'font-weight:600; letter-spacing:.2px; opacity:.9; margin:0 0 6px 2px;';
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.setAttribute('aria-label','Close graph');
            closeBtn.style.cssText = `position:absolute; top:6px; right:8px; width:22px; height:22px; border:none; border-radius:6px; background:rgba(255,255,255,0.08); color:#fff; cursor:pointer; font:16px/20px system-ui; display:flex; align-items:center; justify-content:center; padding:0;`;
            closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.18)'; };
            closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255,255,255,0.08)'; };
            closeBtn.onclick = (e) => { e.stopPropagation(); this.hide(); };
        const canvas = document.createElement('canvas');
        canvas.width = 380; canvas.height = 190; // shorter: only elevation

        el.appendChild(title);
            el.appendChild(closeBtn);
        el.appendChild(canvas);
        map.getContainer().appendChild(el);

        this.container = el;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    },

    show() { this.container.style.display = 'block'; this.visible = true; this.draw(); },
    hide() { this.container.style.display = 'none'; this.visible = false; },
    reset() { this.lengthSamples = []; this.draw(); },
        addLengthSample(km) { /* no-op for now (distance graph removed) */ },
    setElevationData(distsKm, elevsM, status) {
        this.dists = distsKm || [];
        this.elevs = elevsM || [];
        this.statusText = status || '';
        this.draw();
    },

    draw() {
        const ctx = this.ctx; if (!ctx) return;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        // background gradient
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, 'rgba(255,255,255,0.06)');
        bg.addColorStop(1, 'rgba(255,255,255,0.02)');
        ctx.fillStyle = bg; roundRect(ctx, 0, 0, W, H, 10); ctx.fill();

        const padL = 44, padR = 12, padT = 8, padB = 12;
        const elevRect = { x: padL, y: padT + 6, w: W - padL - padR, h: H - padT - padB - 24 };

        // Titles
        ctx.fillStyle = 'rgba(234,234,242,.9)';
        ctx.font = '12px system-ui, Segoe UI, Arial';
        ctx.fillText('Elevation profile (m)', elevRect.x, elevRect.y - 2);

        // Elevation plot
        drawGridY(ctx, elevRect, 4, 'rgba(255,255,255,0.06)');
        if (this.dists.length > 1 && this.elevs.length === this.dists.length) {
            const valid = this.elevs.filter(v => v !== null && !isNaN(v));
            const zmin = Math.min(...valid), zmax = Math.max(...valid);
            const xmax = this.dists[this.dists.length - 1] || 1e-6;

            // y-axis labels
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.font = '11px system-ui';
            for (let i = 0; i <= 4; i++) {
                const val = zmax - (zmax - zmin) * i / 4;
                const y = elevRect.y + elevRect.h * i / 4;
                ctx.fillText(val.toFixed(0), 6, y + 3);
            }

            const pts = [];
            for (let i = 0; i < this.dists.length; i++) {
                const x = elevRect.x + elevRect.w * (this.dists[i] / xmax);
                const z = this.elevs[i]; if (z === null || isNaN(z)) continue;
                const y = elevRect.y + elevRect.h * (1 - (z - zmin) / Math.max(1e-6, (zmax - zmin)));
                pts.push({ x, y });
            }

            if (pts.length >= 2) {
                // area fill
                const g = ctx.createLinearGradient(0, elevRect.y, 0, elevRect.y + elevRect.h);
                g.addColorStop(0, 'rgba(30,136,229,0.40)');
                g.addColorStop(1, 'rgba(30,136,229,0.03)');
                ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.lineTo(pts[pts.length - 1].x, elevRect.y + elevRect.h);
                ctx.lineTo(pts[0].x, elevRect.y + elevRect.h);
                ctx.closePath(); ctx.fillStyle = g; ctx.fill();

                // smooth line with glow
                ctx.save();
                ctx.shadowColor = 'rgba(30,136,229,0.7)'; ctx.shadowBlur = 8;
                ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 2;
                drawSmoothPath(ctx, pts); ctx.stroke(); ctx.restore();

                // sparse dots
                ctx.fillStyle = '#1e88e5';
                const step = Math.ceil(pts.length / 18);
                for (let i = 0; i < pts.length; i += step) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2, 0, Math.PI * 2); ctx.fill(); }
            }
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText('No elevation data', elevRect.x + 8, elevRect.y + elevRect.h/2);
        }

        // Status text (provider, min/max, ascent/descent)
            if (this.statusText) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = '11px system-ui';
                ctx.fillText(this.statusText, elevRect.x, elevRect.y + elevRect.h + 16);
            }
    }
};

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function drawGridY(ctx, rect, rows, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let i = 0; i <= rows; i++) {
        const y = rect.y + rect.h * i / rows;
        ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.w, y); ctx.stroke();
    }
    ctx.restore();
}
function drawSmoothPath(ctx, pts) {
    if (pts.length < 2) { return; }
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.quadraticCurveTo(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
}
modernGraph.init();

// Throttled elevation fetcher (to avoid spamming API while dragging)
let elevationTimer = null;
function scheduleElevationUpdate(polyline) {
    if (!polyline) return;
    if (elevationTimer) return;
    elevationTimer = setTimeout(() => {
        elevationTimer = null;
        fetchElevationProfile(polyline);
    }, 300); // throttle delay
}
// helper for ascent/descent
function calcGainLossM(arr) { let g = 0, l = 0; for (let i=1;i<arr.length;i++){ const d = arr[i]-arr[i-1]; if (isFinite(d)) { if (d>0) g+=d; else l-=d; } } return {g, l}; }

// Replacement elevation profile fetcher feeding modernGraph
async function fetchElevationProfile(polyline) {
    const latlngs = polyline.getLatLngs();
    if (!latlngs || latlngs.length < 2) return;

    const a = latlngs[0], b = latlngs[1];
    const N = 20; // samples along line
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }

    let provider = 'Local DEM', elevations = null;

    // Offline first (CEF/Python)
    if (window.cefPythonBindings && window.cefPythonBindings.getElevations) {
        try {
            const resStr = await window.cefPythonBindings.getElevations(JSON.stringify(pts));
            const data = JSON.parse(resStr);
            if (data && Array.isArray(data.elevations)) elevations = data.elevations;
        } catch (e) { /* ignore */ }
    }

    // Online fallbacks if offline not available
    if (!elevations) {
        try {
            provider = 'OpenTopoData';
            const url = 'https://api.opentopodata.org/v1/srtm90m';
            const body = { locations: pts.map(p => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]) };
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok || !data || !data.results) throw new Error('OpenTopoData failed');
            elevations = data.results.map(r => (r && typeof r.elevation === 'number') ? r.elevation : null);
        } catch (e1) {
            try {
                provider = 'Open-Elevation';
                const url = 'https://api.open-elevation.com/api/v1/lookup';
                const body = { locations: pts.map(p => ({ latitude: p.lat, longitude: p.lng })) };
                const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                const data = await res.json();
                if (!res.ok || !data || !data.results) throw new Error('Open-Elevation failed');
                elevations = data.results.map(r => (r && typeof r.elevation === 'number') ? r.elevation : null);
            } catch(e2) {
                elevations = null;
            }
        }
    }

    // Build distances (km)
    const dists = [0];
    for (let i = 1; i < pts.length; i++) dists.push(dists[i-1] + map.distance(pts[i-1], pts[i]) / 1000);

    if (elevations) {
        const valid = elevations.filter(v => v !== null && !isNaN(v));
        let status = provider + ': No elevation data';
        if (valid.length) {
            const zmin = Math.min(...valid), zmax = Math.max(...valid);
            const gl = calcGainLossM(valid);
            status = `${provider} • Min ${zmin.toFixed(0)} m  Max ${zmax.toFixed(0)} m  +${gl.g.toFixed(0)}/-${gl.l.toFixed(0)} m`;
        }
        modernGraph.setElevationData(dists, elevations, status);
    } else {
        modernGraph.setElevationData(dists, [], 'Elevation fetch failed');
    }
}

// ===== Live dots along the line while dragging =====
const liveOverlay = L.layerGroup().addTo(map);
const liveLineDots = {
    dots: [],
    addFor(polyline, count = 12) {
        this.clear();
        const latlngs = polyline.getLatLngs();
        if (latlngs.length < 2) return;
        const a = latlngs[0], b = latlngs[1];
        for (let i = 1; i < count; i++) {
            const t = i / count;
            const lat = a.lat + (b.lat - a.lat) * t;
            const lng = a.lng + (b.lng - a.lng) * t;
            const dot = L.circleMarker([lat, lng], { radius: 3, color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.9, weight: 1 });
            dot.addTo(liveOverlay);
            this.dots.push(dot);
        }
    },
    updateFor(polyline) {
        const latlngs = polyline.getLatLngs();
        if (latlngs.length < 2 || this.dots.length === 0) return;
        const a = latlngs[0], b = latlngs[1];
        const n = this.dots.length + 1;
        for (let i = 0; i < this.dots.length; i++) {
            const t = (i + 1) / n;
            const lat = a.lat + (b.lat - a.lat) * t;
            const lng = a.lng + (b.lng - a.lng) * t;
            this.dots[i].setLatLng([lat, lng]);
        }
    },
    clear() {
        liveOverlay.clearLayers();
        this.dots = [];
    }
};

// ===== Linking markers to the selection polylines + syncing on drag =====
function linkMarkersWithPolyline(marker1, marker2, polyline) {
    polyline._linkedMarkers = [marker1, marker2];

    if (!marker1._linkedPolylines) marker1._linkedPolylines = new Set();
    if (!marker2._linkedPolylines) marker2._linkedPolylines = new Set();
    marker1._linkedPolylines.add(polyline);
    marker2._linkedPolylines.add(polyline);

    attachMarkerLineSync(marker1);
    attachMarkerLineSync(marker2);
}

function pickPreferredLineForMarker(marker) {
    const lines = marker._linkedPolylines ? Array.from(marker._linkedPolylines) : [];
    if (lines.length === 0) return null;
    if (selectionPolylines.length === 0) return lines[0];
    // pick the line with the highest index in selectionPolylines (most recent/red)
    let best = lines[0], bestIdx = -1;
    lines.forEach(l => {
        const idx = selectionPolylines.indexOf(l);
        if (idx > bestIdx) { bestIdx = idx; best = l; }
    });
    return best;
}

function attachMarkerLineSync(marker) {
    if (marker._lineSyncAttached) return;
    marker._lineSyncAttached = true;

    // defensive: ensure draggable enabled (some Leaflet draw sequences might disable)
    if (!marker.dragging) {
        marker.options.draggable = true;
        if (marker._icon) {
            // Leaflet creates dragging handler lazily
            L.Marker.prototype.options.draggable = true;
        }
    }
    if (marker.dragging && !marker.dragging.enabled()) {
        try { marker.dragging.enable(); } catch(e) {}
    }

    marker.on('dragstart', function () {
        const target = pickPreferredLineForMarker(marker);
        if (!target) return;
    modernGraph.activeLine = target;
    modernGraph.reset();
    modernGraph.show();
    liveLineDots.addFor(target);
    scheduleElevationUpdate(target);
    });

    marker.on('drag', function () {
        if (!marker._linkedPolylines || marker._linkedPolylines.size === 0) return;

        // Update all linked polylines to this marker in real-time
        marker._linkedPolylines.forEach(line => {
            const [m1, m2] = line._linkedMarkers || [];
            if (m1 && m2) {
                line.setLatLngs([m1.getLatLng(), m2.getLatLng()]);
            }
        });

        // Update graph + dotted preview only for the "active" one
    const active = modernGraph.activeLine || pickPreferredLineForMarker(marker);
        if (active) {
            const latlngs = active.getLatLngs();
            if (latlngs.length >= 2) {
                // distance sample no longer graphed; could store if needed
                const result = getDistanceAndAngle(latlngs[0], latlngs[1]); // km + angle
                liveLineDots.updateFor(active);
                scheduleElevationUpdate(active);
            }
        }
    });

    marker.on('dragend', function () {
    // Hide graph + dots when not moving
    modernGraph.hide();
    modernGraph.activeLine = null;
        liveLineDots.clear();
    });
}

// Ensure all existing markers remain draggable (in case overlay or new code interfered)
function ensureAllMarkersDraggable() {
    drawnItems.eachLayer(function(layer){
        if (layer instanceof L.Marker) {
            if (!layer.dragging || !layer.dragging.enabled()) {
                try { layer.options.draggable = true; layer.dragging.enable(); } catch(e) {}
            }
        }
    });
}
// run once after load
setTimeout(ensureAllMarkersDraggable, 500);

let shapeIdCounter = 1;
function generateShapeId() {
    return (shapeIdCounter++);
}

// Add drawn shapes to the map
map.on(L.Draw.Event.CREATED, function (e) {
    var layer = e.layer;
    var type = e.layerType;
    drawnItems.addLayer(layer);
    if (type === "marker") {
        layer._customType = "marker";
        layer.options.draggable = true;
        layer.dragging.enable();
    // enable live sync for drawn markers
    attachMarkerLineSync(layer);
    }
    layer._shapeId = generateShapeId();

    // Bind appropriate popup based on shape type
    if (type === 'polyline') {
       bindPolylinePopup(layer)
    } else if (type === "circle") {
        bindCirclePopup(layer);
    } else if (type === "rectangle") {
        bindRectanglePopup(layer);
    } else if (type === "polygon") {
        bindPolygonPopup(layer);
    }
});

// Save original addVertex once
const origPolylineAddVertex = L.Draw.Polyline.prototype.addVertex;

L.Draw.Polyline.include({
  addVertex: function (latlng) {
    // If this is actually the Polygon drawing handler, use the original behavior
    if (this instanceof L.Draw.Polygon) {
      return origPolylineAddVertex.call(this, latlng);
    }

    // --- your polyline-only behavior (unchanged) ---
    var markersCount = this._markers.length;

    if (markersCount >= 1) {
      this.disable();
      return;
    }

    this._markers.push(this._createMarker(latlng));
    this._poly.addLatLng(latlng);

    if (this._poly.getLatLngs().length === 2) {
      this._map.addLayer(this._poly);
    }

    this._vertexChanged(latlng, true);
  }
});

L.Draw.Polyline.prototype._getTooltipText = function () {
    var showLength = this.options.showLength;
    var labelText = L.drawLocal.draw.handlers.polyline.tooltip;
    var n = this._markers ? this._markers.length : 0;
    var text, subtext = '';

    if (n === 0) {
        text = labelText.start;
    } else if (n === 1) {
        text = labelText.cont;
    } else {
        text = labelText.end;
    }

    if (showLength && n > 0) {
        var latlngs = this._poly.getLatLngs().slice();

        // Add current cursor position to distance calculation (for live segment)
        if (this._currentLatLng) {
            latlngs.push(this._currentLatLng);
        }

        // Calculate total distance (including current preview)
        var distance = L.GeometryUtil.readableDistance(
            L.GeometryUtil.length(latlngs)
        );
        subtext = distance;

        // Calculate angle of the latest segment
        if (latlngs.length >= 2) {
            var last = latlngs[latlngs.length - 1];
            var prev = latlngs[latlngs.length - 2];
            var angle = (L.GeometryUtil.bearing(prev, last) + 360) % 360;
            subtext += `<br>Angle: ${angle.toFixed(2)}°`;
        }
    }

    return {
        text: text,
        subtext: subtext
    };
};


function getDistanceAndAngle(latlng1, latlng2) {
    var distance = map.distance(latlng1, latlng2);
    // var distance = L.GeometryUtil.distance(map, latlng1, latlng2);
    var angle = L.GeometryUtil.bearing(latlng1, latlng2);
    // if (angle < 0) angle += 360;
    return {
        distance: distance/1000,
        angle: angle
    };
}

let currentShapeForColorChange = null;

// Global function to handle color change from Python
function changeShapeColor(newColor) {
    if (currentShapeForColorChange && newColor) {
        currentShapeForColorChange.setStyle({ color: newColor });
        currentShapeForColorChange = null;
    }
}

// Function to open color picker (will be called by the popup buttons)
function openColorPickerForShape(shape) {
    currentShapeForColorChange = shape;
    if (window.cefPythonBindings && window.cefPythonBindings.openColorPicker) {
        const currentColor = shape.options.color || '#3388ff';
        window.cefPythonBindings.openColorPicker(currentColor);
    } else {
        alert("Color picker not available!");
    }
}

// Generic popup function for shapes (circle, rectangle, polygon)
function bindShapePopup(shape, shapeType) {
    shape.bindPopup(
        `<div>
            <button id='delete-${shapeType}-btn'>Delete this ${shapeType}</button><br><br>
            <button id='change-${shapeType}-color'>Change Color</button>
        </div>`
    );
    
    shape.on('popupopen', function () {
        const deleteBtn = document.getElementById(`delete-${shapeType}-btn`);
        const colorBtn = document.getElementById(`change-${shapeType}-color`);
        
        if (deleteBtn) {
            deleteBtn.onclick = function () {
                drawnItems.removeLayer(shape);
                shape.closePopup();
            };
        }
        
        if (colorBtn) {
            colorBtn.onclick = function () {
                openColorPickerForShape(shape);
                shape.closePopup();
            };
        }
    });
}

function bindPolylinePopup(polyline) {
    const latlngs = polyline.getLatLngs();
    
    const result = getDistanceAndAngle(latlngs[0], latlngs[1]);
    polyline.bindPopup(
        `<div>
            <button id='delete-polyline-btn'>Delete this polyline</button><br>
            <b>Polyline Info</b><br>
            Distance: ${result.distance.toFixed(2)} km<br>
            Angle: ${result.angle.toFixed(2)}°<br><br>
            <button id='change-polyline-color'>Change Color</button><br><br>
            <button id='show-polyline-graph'>Show Graph</button>
        </div>`
    );
    polyline.on('popupopen', function () {
        const deleteBtn = document.getElementById('delete-polyline-btn');
        const colorBtn = document.getElementById('change-polyline-color');
        const graphBtn = document.getElementById('show-polyline-graph');
        
        if (deleteBtn) {
            deleteBtn.onclick = function () {
                drawnItems.removeLayer(polyline);
                polyline.closePopup();
            };
        }
        
        if (colorBtn) {
            colorBtn.onclick = function () {
                openColorPickerForShape(polyline);
                polyline.closePopup();
            };
        }
        if (graphBtn) {
            graphBtn.onclick = function () {
                modernGraph.activeLine = polyline;
                modernGraph.reset();
                modernGraph.show();
                scheduleElevationUpdate(polyline);
                polyline.closePopup();
            };
        }
    });
}

function bindCirclePopup(circle) {
    bindShapePopup(circle, 'circle');
}

function bindRectanglePopup(rectangle) {
    bindShapePopup(rectangle, 'rectangle');
}

function bindPolygonPopup(polygon) {
    bindShapePopup(polygon, 'polygon');
}

function deselect() {
    drawnItems.eachLayer(function(layer) {
        drawnItems.removeLayer(layer);
    });
}


// Custom marker icon
var customIcon = L.icon({
    iconUrl: 'images/pin.png',
    iconSize: [32, 40],
    iconAnchor: [16, 40]
});

var customIconSelected = L.icon({
    iconUrl: 'images/pin1.png',
    iconSize: [32, 40],
    iconAnchor: [16, 40]
});

// State variables
var clickToPlace = false;
let customPolylineMode = false;
let startPoint = null;
let previewLine = null;

// Toggle pin mode (called from Python)
function togglePinMode() {
    clickToPlace = !clickToPlace;
    const container = map.getContainer();
    container.classList.toggle('leaflet-crosshair', clickToPlace);
    container.classList.toggle('leaflet-grab', !clickToPlace);
}

let selectedMarkers = [];
let selectionPolylines = [];

function createMarker(latlng) {
    const marker = L.marker(latlng, {
        icon: customIcon,
        draggable: true
    });
    marker._shapeId = generateShapeId("custommarker");
    marker._customType = "custommarker";
    drawnItems.addLayer(marker);
    marker.options.draggable = true;
    marker.dragging.enable();

    // enable live sync on user-created markers
    attachMarkerLineSync(marker);

    marker.bindPopup(`
        <button id='delete-marker-btn'>Delete this marker</button><br><br>
        <button id='select-button'>Select this marker</button>
    `);

    marker.on('popupopen', function () {
        document.getElementById('delete-marker-btn').onclick = function () {
            drawnItems.removeLayer(marker);
            // selectedMarkers = selectedMarkers.filter(m => m !== marker);
            marker.closePopup();
        };
        document.getElementById('select-button').onclick = function () {
            handleMarkerSelection(marker);
            marker.closePopup();
        };
    });

    return marker;
}

function handleMarkerSelection(marker) {
    if (!selectedMarkers.includes(marker)) {
        selectedMarkers.push(marker);
        highlightMarker(marker, true);
    }
    if (selectedMarkers.length === 2) {
        drawLineBetweenMarkers(selectedMarkers[0], selectedMarkers[1]);
        setTimeout(() => {
            selectedMarkers.forEach(m => highlightMarker(m, false));
            selectedMarkers = [];
        }, 100);
    }
}

function highlightMarker(marker, highlight) {
    if (highlight) {
        marker.setIcon(customIconSelected);
    } else {
        marker.setIcon(customIcon);
    }
}

function drawLineBetweenMarkers(marker1, marker2) {
    const latlngs = [marker1.getLatLng(), marker2.getLatLng()];
    const polyline = L.polyline(latlngs, { color: 'red', weight: 3 }); 
    drawnItems.addLayer(polyline);
    bindPolylinePopup(polyline);
    selectionPolylines.push(polyline);
    updatePolylineColors();

    // link markers <-> line for live updates
    linkMarkersWithPolyline(marker1, marker2, polyline);

    // Auto-fetch elevation immediately for new line
    scheduleElevationUpdate(polyline);

    // enhance deletion behavior to unlink properly
    polyline.on('popupopen', function () {
        const deleteBtn = document.getElementById('delete-polyline-btn');
        if (deleteBtn) {
            deleteBtn.onclick = function () {
                if (polyline._linkedMarkers) {
                    polyline._linkedMarkers.forEach(m => {
                        if (m && m._linkedPolylines) m._linkedPolylines.delete(polyline);
                    });
                }
                selectionPolylines = selectionPolylines.filter(l => l !== polyline);
                drawnItems.removeLayer(polyline);
                polyline.closePopup();
            };
        }
        const colorBtn = document.getElementById('change-polyline-color');
        if (colorBtn) {
            colorBtn.onclick = function () {
                openColorPickerForShape(polyline);
                polyline.closePopup();
            };
        }
        const graphBtn = document.getElementById('show-polyline-graph');
        if (graphBtn) {
            graphBtn.onclick = function () {
                modernGraph.activeLine = polyline;
                modernGraph.reset();
                modernGraph.show();
                scheduleElevationUpdate(polyline);
                polyline.closePopup();
            };
        }
    });
}

function updatePolylineColors() {
    selectionPolylines.forEach(line => line.setStyle({ color: 'blue' }));
    if (selectionPolylines.length > 0) {
        selectionPolylines[selectionPolylines.length - 1].setStyle({ color: 'red' });
    }
}

let lastCustomPolyline = null;

function handleCustomPolylineDraw(e) {
    if (!startPoint) {
        startPoint = e.latlng;
    } else {
        if (lastCustomPolyline) {
            lastCustomPolyline.setStyle({ color: 'blue' });
        }

        const polyline = L.polyline([startPoint, e.latlng], {
            color: 'red'
        });
        polyline._shapeId = generateShapeId("polyline");
        drawnItems.addLayer(polyline);

        lastCustomPolyline = polyline;

        const latlngs = polyline.getLatLngs();
        const result = getDistanceAndAngle(latlngs[0], latlngs[1]);
        polyline.bindPopup(
            `<div>
                <button id='delete-polyline-btn'>Delete this polyline</button><br>
                <b>Polyline Info</b><br>
                Distance: ${result.distance.toFixed(3)} km<br>
                Angle: ${result.angle.toFixed(3)}°<br><br>
                <button id='change-custom-polyline-color'>Change Color</button><br><br>
                <button id='show-custom-polyline-graph'>Show Graph</button>
            </div>`
        );

        polyline.on('popupopen', function () {
            const deleteBtn = document.getElementById('delete-polyline-btn');
            const colorBtn = document.getElementById('change-custom-polyline-color');
            const graphBtn = document.getElementById('show-custom-polyline-graph');
            
            if (deleteBtn) {
                deleteBtn.onclick = function () {
                    drawnItems.removeLayer(polyline);
                    if (lastCustomPolyline === polyline) {
                        lastCustomPolyline = null;
                    }
                    polyline.closePopup();
                };
            }
            
            if (colorBtn) {
                colorBtn.onclick = function () {
                    openColorPickerForShape(polyline);
                };
            }
            if (graphBtn) {
                graphBtn.onclick = function () {
                    modernGraph.activeLine = polyline;
                    modernGraph.reset();
                    modernGraph.show();
                    scheduleElevationUpdate(polyline);
                    polyline.closePopup();
                };
            }
        });

        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }

        startPoint = null;
        customPolylineMode = false;
        map.getContainer().style.cursor = '';
    }
}
// Start custom polyline mode (can be called from a menu)
function startPolyline() {
    customPolylineMode = true;
    startPoint = null;
    map.getContainer().style.cursor = 'crosshair';
    hideMapMenu();
}

// Show a preview line while drawing
map.on('mousemove', function (e) {
    if (customPolylineMode && startPoint) {
        if (!previewLine) {
            previewLine = L.polyline([startPoint, e.latlng], {
                color: 'blue'

            }).addTo(map);
        } else {
            previewLine.setLatLngs([startPoint, e.latlng]);
        }
    }
});


// --- MAP CONTEXT MENU LOGIC (right-click) ---

// Show map context menu
map.on('contextmenu', function (e) {
    const menu = document.getElementById('map-menu');
    menu.style.left = e.originalEvent.pageX + 'px';
    menu.style.top = e.originalEvent.pageY + 'px';
    menu.style.display = 'block';
    setTimeout(() => { menuJustOpened = false; }, 100);
});

// reload function
function reloadMap() {
    location.reload();
}

function hideMapMenu() {
    document.getElementById('map-menu').style.display = 'none';
}

// Hide map menu when clicking elsewhere
let menuJustOpened = false;
document.addEventListener('click', function (e) {
    const mapMenu = document.getElementById('map-menu');
    if (!mapMenu.contains(e.target)) hideMapMenu();
});

// Import shapeshon
function importShapes(jsonStr) {
    let shapes;
    try {
        shapes = JSON.parse(jsonStr);
    } catch (e) {
        alert("Invalid JSON data!");
        return;
    }
    // drawnItems.clearLayers();
    shapes.forEach(shape => {
        let layer;
        if (shape.type === "custommarker") {
            layer = L.marker(shape.latlngs[0], { icon: customIcon, draggable: true });
            drawnItems.addLayer(layer);
            layer.dragging.enable();
            attachMarkerLineSync(layer);
            layer.bindPopup(`
        <button id='delete-marker-btn'>Delete this marker</button><br><br>
        <button id='select-button'>Select this marker</button>
         `);

            layer.on('popupopen', function () {
                document.getElementById('delete-marker-btn').onclick = function () {
                    drawnItems.removeLayer(layer);
                    // selectedMarkers = selectedMarkers.filter(m => m !== marker);
                    layer.closePopup();
                };
                document.getElementById('select-button').onclick = function () {
                    handleMarkerSelection(layer);
                    layer.closePopup();
                };
            });
        }
        else if (shape.type === "marker") {
            layer = L.marker(shape.latlngs[0], { draggable: true });
            drawnItems.addLayer(layer);
            layer.dragging.enable();
            attachMarkerLineSync(layer);
        }
        else if (shape.type === "polyline") {
            layer = L.polyline(shape.latlngs, { color: shape.color || '#3388ff' });
            bindPolylinePopup(layer);
            drawnItems.addLayer(layer);
        }
        else if (shape.type === "polygon") {
            layer = L.polygon(shape.latlngs, { color: shape.color || '#3388ff' });
            bindPolygonPopup(layer);
            drawnItems.addLayer(layer);
        }
        else if (shape.type === "rectangle") {
            layer = L.rectangle(shape.latlngs, { color: shape.color || '#3388ff' });
            bindRectanglePopup(layer);
            drawnItems.addLayer(layer);
        }
        else if (shape.type === "circle") {
            layer = L.circle(shape.latlngs[0], { radius: shape.radius, color: shape.color || '#3388ff' });
            bindCirclePopup(layer);
            drawnItems.addLayer(layer);
        }
        if (layer) {
            layer._shapeId = shape.id;
            // layer._note = shape.note || "";
            drawnItems.addLayer(layer);
        }
    });
}


function exportShapes(filePath) {
    const shapes = [];
    drawnItems.eachLayer(function (layer) {
        // Collect your shape data here, e.g.:
        let shape = {
            id: layer._shapeId || null,
            type: layer._customType || null,
            latlngs: null,
            // note: layer._note || "",
            color: layer.options && layer.options.color ? layer.options.color : undefined
        };

        if (layer instanceof L.Marker) {
            // shape.type = "marker";
            shape.latlngs = [layer.getLatLng()];
        }
        else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
            shape.type = "polyline";
            shape.latlngs = layer.getLatLngs();
        }
        else if (layer instanceof L.Polygon && !(layer instanceof L.Rectangle)) {
            shape.type = "polygon";
            shape.latlngs = layer.getLatLngs();
        }
        else if (layer instanceof L.Rectangle) {
            shape.type = "rectangle";
            shape.latlngs = layer.getLatLngs();
        }
        else if (layer instanceof L.Circle) {
            shape.type = "circle";
            shape.latlngs = [layer.getLatLng()];
            shape.radius = layer.getRadius();
        }

        shapes.push(shape);
    });
    console.log("Calling Python to save:", filePath, shapes);
    if (window.cefPythonBindings) {
        window.cefPythonBindings.saveShapesToFile(JSON.stringify(shapes), filePath);
    } else {
        alert("Python bindings not available!");
    }
}

// Main map click handler
map.on('click', function (e) {
    hideMapMenu();

    if (clickToPlace) {
        createMarker(e.latlng);
    }

    if (customPolylineMode) {
        handleCustomPolylineDraw(e);
    }
});
/**
 * SEEE Cesium Viewer.
 *
 * Loads a 3D Tiles tileset into Cesium for visualization, fetches the same
 * tileset through the SEEE MeshLoader, runs the Triangle → Region → Entity
 * pipeline, and overlays extracted entity bounding boxes on the scene.
 *
 * Click an entity in the list (or on the globe) to highlight / fly to it.
 */
import { SEEE, labelColor } from "@seee/sdk";
import type { Entity } from "@seee/core";
import "./style.css";

// Cesium is loaded from a CDN <script> tag in index.html.
declare const Cesium: any;

const DEFAULT_URL = "https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const elStatus = $<HTMLDivElement>("status");
const elMeshUrl = $<HTMLInputElement>("meshUrl");
const elLoad = $<HTMLButtonElement>("loadBtn");
const elExtract = $<HTMLButtonElement>("extractBtn");
const elClear = $<HTMLButtonElement>("clearBtn");
const elStatTri = $<HTMLElement>("statTri");
const elStatReg = $<HTMLElement>("statReg");
const elStatEnt = $<HTMLElement>("statEnt");
const elStatTime = $<HTMLElement>("statTime");
const elList = $<HTMLUListElement>("entityList");
const elFilter = $<HTMLInputElement>("filterInput");
const elRelType = $<HTMLSelectElement>("relType");
const elRelList = $<HTMLUListElement>("relList");

const engine = new SEEE({
  regionOptions: { maxAngle: 25, maxDistance: 2.0, maxCurvature: 0.6, minRegionSize: 2 },
  topologyOptions: { minTouchArea: 1, minBoundary: 0, enableSupport: true, supportGap: 2.0, maxMergeAngle: 30 },
  chunkSize: 200_000,
  cacheCapacity: 128,
});

let viewer: any = null;
let tileset: any = null;
let selectedId: number | null = null;

function setStatus(text: string, kind: "idle" | "busy" | "ok" | "err" = "idle") {
  elStatus.textContent = text;
  elStatus.className = "status " + kind;
}

/* ----------------------------- Cesium viewer ------------------------------ */
function initViewer(): void {
  viewer = new Cesium.Viewer("cesiumContainer", {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    timeline: false,
    animation: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    imageryProvider: new Cesium.UrlTemplateImageryProvider({
      url: "https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
      maximumLevel: 18,
    }),
  });
  // Hide the default Cesium credit logo to keep the demo clean.
  try {
    (viewer as any).creditDisplay.container.style.display = "none";
  } catch {
    /* ignore */
  }
  engine.attach({
    scene: viewer.scene,
    entities: viewer.entities,
    camera: viewer.camera,
  });
  // Click handler: pick an entity by world position.
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((evt: any) => {
    const cartesian = viewer.scene.pickPosition(evt.position);
    if (!cartesian) return;
    const p = Cesium.Cartesian3.fromCartesian(cartesian);
    const entity = engine.pick([p.x, p.y, p.z]);
    if (entity) {
      selectEntity(entity.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/* ------------------------------- tileset ---------------------------------- */
async function loadTileset(): Promise<void> {
  const url = elMeshUrl.value.trim() || DEFAULT_URL;
  setStatus("loading 3D tiles…", "busy");
  elLoad.disabled = true;
  try {
    if (tileset) {
      viewer.scene.primitives.remove(tileset);
      tileset = null;
    }
    tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
      skipLevelOfDetail: true,
      preferLeaves: false,
      dynamicScreenSpaceError: true,
    });
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    setStatus("tileset ready", "ok");
    elExtract.disabled = false;
  } catch (err: any) {
    setStatus("tileset load failed", "err");
    console.error("[viewer] tileset load failed", err);
  } finally {
    elLoad.disabled = false;
  }
}

/* ------------------------------- SEEE load -------------------------------- */
async function runExtraction(): Promise<void> {
  setStatus("loading mesh…", "busy");
  elExtract.disabled = true;
  const t0 = performance.now();
  try {
    // Load a bounded subset of the tileset for fast in-browser extraction.
    // The root + first levels already produce hundreds of thousands of
    // triangles, enough to validate the Triangle → Region → Entity pipeline.
    await engine.load(elMeshUrl.value.trim() || DEFAULT_URL, {
      maxTiles: 24,
      maxTriangles: 1_000_000,
      maxDepth: 3,
      onProgress: (info) => {
        setStatus(`loading mesh… (${info.tilesLoaded} tiles)`, "busy");
      },
    });
    setStatus("extracting entities…", "busy");
    const entities = await engine.extract();
    const t1 = performance.now();
    elStatTri.textContent = String(engine.getTriangles().length);
    elStatReg.textContent = String(entities.reduce((s, e) => s + e.regions.length, 0));
    elStatEnt.textContent = String(entities.length);
    elStatTime.textContent = `${Math.round(t1 - t0)}ms`;
    renderEntityList(entities);
    overlayEntities(entities);
    setStatus(`extracted ${entities.length} entities`, "ok");
  } catch (err: any) {
    setStatus("extraction failed: " + (err?.message ?? err), "err");
    console.error("[viewer] extraction failed", err);
  } finally {
    elExtract.disabled = false;
  }
}

/* --------------------------- entity overlays ------------------------------ */
function overlayEntities(entities: Entity[]): void {
  viewer.entities.removeAll();
  for (const e of entities) {
    const c = labelColor(e.label);
    const color = new Cesium.Color(c.red, c.green, c.blue, 0.18);
    const outline = new Cesium.Color(c.red, c.green, c.blue, 0.95);
    const center = [
      (e.bbox.min[0] + e.bbox.max[0]) / 2,
      (e.bbox.min[1] + e.bbox.max[1]) / 2,
      (e.bbox.min[2] + e.bbox.max[2]) / 2,
    ];
    const dims = [
      e.bbox.max[0] - e.bbox.min[0],
      e.bbox.max[1] - e.bbox.min[1],
      e.bbox.max[2] - e.bbox.min[2],
    ];
    viewer.entities.add({
      id: `seee-ent-${e.id}`,
      name: `Entity ${e.id} (${e.label})`,
      position: new Cesium.Cartesian3(center[0], center[1], center[2]),
      box: {
        dimensions: new Cesium.Cartesian3(dims[0], dims[1], dims[2]),
        fill: color,
        outline: true,
        outlineColor: outline,
      },
    });
  }
}

function highlightEntity(id: number): void {
  // Toggle: clicking the same entity again clears the highlight.
  const prevSelected = selectedId;
  selectedId = null;
  // Reset all to dim.
  viewer.entities.values.forEach((ent: any) => {
    if (ent.box) {
      ent.box.fill = ent.box.fill.withAlpha(0.08);
    }
  });
  if (prevSelected === id) {
    return;
  }
  selectedId = id;
  const e = engine.getEntity(id);
  if (!e) return;
  const target = viewer.entities.getById(`seee-ent-${id}`);
  if (target && target.box) {
    target.box.fill = target.box.fill.withAlpha(0.5);
    target.box.outlineColor = Cesium.Color.fromCssColorString("#ffe14d");
  }
  // Fly camera to the entity.
  const c = [(e.bbox.min[0] + e.bbox.max[0]) / 2, (e.bbox.min[1] + e.bbox.max[1]) / 2, (e.bbox.min[2] + e.bbox.max[2]) / 2];
  const center = new Cesium.Cartesian3(c[0], c[1], c[2]);
  const range = Math.max(
    e.bbox.max[0] - e.bbox.min[0],
    e.bbox.max[1] - e.bbox.min[1],
    e.bbox.max[2] - e.bbox.min[2],
  ) * 4 + 20;
  viewer.camera.flyTo({
    destination: new Cesium.Cartesian3(
      center.x + range,
      center.y + range,
      center.z + range,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-35),
      roll: 0,
    },
    duration: 1.0,
  });
  renderRelations(id);
}

function selectEntity(id: number): void {
  // Update list highlight state.
  selectedId = id;
  highlightEntity(id);
  document.querySelectorAll<HTMLElement>("#entityList li").forEach((li) => {
    li.classList.toggle("active", li.dataset.id === String(id));
  });
}

/* ------------------------------- UI lists -------------------------------- */
function renderEntityList(entities: Entity[]): void {
  elList.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const e of entities) {
    const li = document.createElement("li");
    li.dataset.id = String(e.id);
    li.innerHTML = `<span>#${e.id}</span><span class="badge">${e.label}</span>`;
    li.addEventListener("click", () => selectEntity(e.id));
    frag.appendChild(li);
  }
  elList.appendChild(frag);
  renderRelations(null);
}

function applyFilter(): void {
  const q = elFilter.value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>("#entityList li").forEach((li) => {
    const text = li.textContent ?? "";
    li.style.display = !q || text.toLowerCase().includes(q) ? "" : "none";
  });
}

function renderRelations(nodeId: number | null): void {
  elRelList.innerHTML = "";
  const type = elRelType.value as "" | "touch" | "adjacent" | "support" | "contain" | "intersect";
  const opts: { type?: any; nodeId?: number } = {};
  if (type) opts.type = type;
  if (nodeId !== null) opts.nodeId = nodeId;
  const edges = engine.query(opts);
  for (const e of edges) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${e.from} → ${e.to}</span><span class="badge">${e.type}</span>`;
    elRelList.appendChild(li);
  }
}

/* ------------------------------ wire-up ---------------------------------- */
elLoad.addEventListener("click", loadTileset);
elExtract.addEventListener("click", runExtraction);
elClear.addEventListener("click", () => {
  viewer.entities.removeAll();
  elList.innerHTML = "";
  elRelList.innerHTML = "";
  elStatTri.textContent = "0";
  elStatReg.textContent = "0";
  elStatEnt.textContent = "0";
  elStatTime.textContent = "0ms";
  selectedId = null;
  setStatus("cleared", "idle");
});
elFilter.addEventListener("input", applyFilter);
elRelType.addEventListener("change", () => renderRelations(selectedId));

// Boot once the DOM (and Cesium) is ready.
window.addEventListener("DOMContentLoaded", () => {
  try {
    initViewer();
    setStatus("ready", "ok");
  } catch (err: any) {
    setStatus("init failed: " + (err?.message ?? err), "err");
    console.error(err);
  }
});

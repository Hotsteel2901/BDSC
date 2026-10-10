import * as THREE from 'three';

/**
 * AsciiComposer
 * -------------
 * Renders a three.js scene to an offscreen HDR-ish target, then resolves it into
 * a grid of ASCII glyphs via a full-screen shader. Lighting/colour from the real
 * 3D scene is preserved and used to tint the glyphs, while a density-ordered
 * character ramp + Sobel edge detection produce crisp, unified ASCII art.
 */

// Density-ordered ramps. Index 0 = darkest, last = brightest.
//
// DEFAULT (clean): kept deliberately *short*. The old 90-glyph ramp packed many
// near-identical densities next to each other, so flat surfaces shimmered
// between neighbouring glyphs and the whole frame turned into illegible
// letter-soup ("eye strain"). A coarse, well-separated ramp quantises cleanly
// and reads as structure.
export const DEFAULT_RAMP =
  ' .:-=+*#%@';

// The original high-density ramp, still selectable for players who want the
// fine-grained look.
export const DETAIL_RAMP =
  ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

// A second ramp that leans on symbols for a more "terminal" look.
export const SYMBOL_RAMP =
  ' .-:~=+*ox%#@';

/**
 * Structural line glyphs appended to every ramp. They are selected by gradient
 * *orientation* on edges (instead of a dense texture glyph), which is what
 * makes architecture and enemy silhouettes read as clean line art rather than
 * dissolving into noise. Order matters: index 0..3 = |  -  /  \.
 */
export const EDGE_GLYPHS = '|-/\\';

/** Append the structural edge glyphs to a density ramp. */
export function fullRamp(densityRamp) {
  return densityRamp + EDGE_GLYPHS;
}

export class AsciiComposer {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.charSize = opts.charSize || 12;     // cell size in screen px
    this.resMult = opts.resMult || 4;        // internal pixels per cell (AA for small bright features)
    this.color = opts.color !== false;       // tint glyphs with scene colour
    this.edge = opts.edge !== false;         // sobel edge -> outline glyphs
    this.contrast = opts.contrast ?? 1.10;
    this.brightness = opts.brightness ?? 2.20;
    this.saturation = opts.saturation ?? 1.15;
    this.gamma = opts.gamma ?? 0.4545; // linear -> sRGB (1/2.2)
    this.densityRamp = opts.ramp || DEFAULT_RAMP;
    this.ramp = fullRamp(this.densityRamp);   // density glyphs + structural edges
    this.densityLen = this.densityRamp.length;
    this.edgeBase = this.densityLen;
    this.fg = new THREE.Color(opts.fg || 0x9dffbf);
    this.bg = new THREE.Color(opts.bg || 0x03060a);
    this.enabled = opts.enabled !== false;
    this.fx = {
      // Very restrained post FX. Heavy scanlines / grain / aberration / vignette
      // all ate into glyph legibility and, critically, multiplied the frame
      // darker — they now default near-off and can still be tuned per option.
      scanline: opts.scanline ?? 0.03,
      vignette: opts.vignette ?? 0.07,
      bloom: opts.bloom ?? 0.34,
      aberration: opts.aberration ?? 0.18,
      noise: opts.noise ?? 0.006,
      flicker: opts.flicker ?? 0.003,
    };
    // Fraction of the cell colour painted into the empty part of every glyph
    // cell. ASCII glyphs only ink ~20-40% of a cell, so without this the vast
    // majority of the frame collapses to background black and the whole image
    // reads far darker than the raw 3D render.
    this.fill = opts.fill ?? 0.52;

    this.fontTexture = makeFontAtlas(this.ramp, 32);
    this.fontCols = this.fontTexture.userData.cols;
    this.fontRows = this.fontTexture.userData.rows;

    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    // Full-res bright pass (for cheap bloom) reused between frames.
    this.brightRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBright: { value: null },
        tFont: { value: this.fontTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCharSize: { value: this.charSize },
        uFontCols: { value: this.fontCols },
        uFontRows: { value: this.fontRows },
        uRampLen: { value: this.ramp.length },
        uDensityLen: { value: this.densityLen },
        uEdgeBase: { value: this.edgeBase },
        uColor: { value: this.color ? 1 : 0 },
        uEdge: { value: this.edge ? 1 : 0 },
        uContrast: { value: this.contrast },
        uBrightness: { value: this.brightness },
        uSaturation: { value: this.saturation },
        uGamma: { value: this.gamma },
        uFg: { value: new THREE.Vector3(this.fg.r, this.fg.g, this.fg.b) },
        uBg: { value: new THREE.Vector3(this.bg.r, this.bg.g, this.bg.b) },
        uFill: { value: this.fill },
        uTime: { value: 0 },
        uScanline: { value: this.fx.scanline },
        uVignette: { value: this.fx.vignette },
        uBloom: { value: this.fx.bloom },
        uAberration: { value: this.fx.aberration },
        uNoise: { value: this.fx.noise },
        uFlicker: { value: this.fx.flicker },
        uHit: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene;
        uniform sampler2D tBright;
        uniform sampler2D tFont;
        uniform vec2 uResolution;
        uniform float uCharSize;
        uniform float uFontCols;
        uniform float uFontRows;
        uniform float uRampLen;
        uniform float uDensityLen;
        uniform float uEdgeBase;
        uniform float uColor;
        uniform float uEdge;
        uniform float uContrast;
        uniform float uBrightness;
        uniform float uSaturation;
        uniform float uGamma;
        uniform vec3 uFg;
        uniform vec3 uBg;
        uniform float uFill;
        uniform float uTime;
        uniform float uScanline;
        uniform float uVignette;
        uniform float uBloom;
        uniform float uAberration;
        uniform float uNoise;
        uniform float uFlicker;
        uniform float uHit;

        float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        // Full colour grade pipeline (brightness → contrast → saturation →
        // highlight rolloff → gamma). Factored out so several texels per cell
        // can be graded and the brightest one chosen.
        vec3 grade(vec3 c){
          c *= uBrightness;
          c = (c - 0.5) * uContrast + 0.5;
          float l = luma(c);
          c = mix(vec3(l), c, uSaturation);
          c = max(c, vec3(0.0));
          vec3 over = max(c - 0.45, vec3(0.0));
          c = min(c, vec3(0.45)) + over / (1.0 + over * 2.5);
          return pow(c, vec3(uGamma));
        }

        float hash(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main(){
          float cell = uCharSize;
          vec2 px = vUv * uResolution;
          vec2 cellIdx = floor(px / cell);
          vec2 cellUv = fract(px / cell);

          // sample the scene at the centre of the cell
          vec2 sampleUv = (cellIdx * cell + cell * 0.5) / uResolution;

          // chromatic aberration (centre tap only)
          vec2 ca = (cellUv - 0.5) * (uAberration / uResolution) * 2.0;
          vec3 col;
          col.r = texture2D(tScene, sampleUv + ca).r;
          col.g = texture2D(tScene, sampleUv).g;
          col.b = texture2D(tScene, sampleUv - ca).b;

          // --- stable fill ---
          // Average a small cross of taps so a flat surface settles on a single
          // glyph instead of shimmering between neighbouring density levels.
          vec2 off = vec2(cell * 0.34) / uResolution;
          vec3 sR = texture2D(tScene, sampleUv + vec2(off.x, 0.0)).rgb;
          vec3 sL = texture2D(tScene, sampleUv - vec2(off.x, 0.0)).rgb;
          vec3 sD = texture2D(tScene, sampleUv + vec2(0.0, off.y)).rgb;
          vec3 sU = texture2D(tScene, sampleUv - vec2(0.0, off.y)).rgb;
          vec3 fillRaw = (col * 2.0 + sR + sL + sD + sU) / 6.0;

          // brightest texel (keeps tiny bright features: markers / tracers / flashes)
          vec3 rawPeak = col; float rawL = luma(col); float peakFound = 0.0;
          float sl = luma(sR); if (sl > rawL) { rawL = sl; rawPeak = sR; peakFound = 1.0; }
          sl = luma(sL); if (sl > rawL) { rawL = sl; rawPeak = sL; peakFound = 1.0; }
          sl = luma(sD); if (sl > rawL) { rawL = sl; rawPeak = sD; peakFound = 1.0; }
          sl = luma(sU); if (sl > rawL) { rawL = sl; rawPeak = sU; peakFound = 1.0; }

          vec3 gFill = grade(fillRaw);
          float l = luma(gFill);
          if (peakFound > 0.5) {
            vec3 gp = grade(rawPeak); float gl = luma(gp);
            float adopt = smoothstep(0.10, 0.34, gl - l);
            gFill = mix(gFill, gp, adopt);
            l = mix(l, gl, adopt);
          }

          // --- edges at cell scale (luminance sobel) ---
          float edgeAmt = 0.0; float egx = 0.0, egy = 0.0;
          if (uEdge > 0.5) {
            vec2 t = vec2(cell) / uResolution;
            float eR = luma(texture2D(tScene, sampleUv + vec2(t.x, 0.0)).rgb);
            float eL = luma(texture2D(tScene, sampleUv - vec2(t.x, 0.0)).rgb);
            float eD = luma(texture2D(tScene, sampleUv + vec2(0.0, t.y)).rgb);
            float eU = luma(texture2D(tScene, sampleUv - vec2(0.0, t.y)).rgb);
            egx = eR - eL;
            egy = eD - eU;
            edgeAmt = clamp(length(vec2(egx, egy)) * 2.2, 0.0, 1.0);
          }

          // add a touch of the bright pass (bloom) to luminance only
          float bloom = luma(texture2D(tBright, sampleUv).rgb);
          l += bloom * uBloom;
          edgeAmt = max(edgeAmt, bloom * 0.65);

          // choose density glyph from the stable fill
          float lum = clamp(l, 0.0, 1.0);
          float idx = floor(lum * (uDensityLen - 1.0) + 0.5);

          // On strong edges prefer a *structural* glyph chosen by the gradient
          // orientation, so walls/targets read as crisp line art.
          if (uEdge > 0.5 && edgeAmt > 0.5) {
            float adx = abs(egx), ady = abs(egy);
            float sel;
            if (adx > ady * 1.45) sel = 0.0;            // vertical edge -> |
            else if (ady > adx * 1.45) sel = 1.0;       // horizontal edge -> -
            else sel = (egx * egy > 0.0) ? 3.0 : 2.0;   // \ or /
            idx = uEdgeBase + sel;
          }

          float gx = mod(idx, uFontCols);
          float gy = floor(idx / uFontCols);
          vec2 glyphUv = (vec2(gx, gy) + cellUv) / vec2(uFontCols, uFontRows);
          float glyph = texture2D(tFont, glyphUv).r;

          vec3 outCol = mix(vec3(1.0), gFill, uColor);
          outCol = mix(uFg * (0.55 + l * 0.9), outCol, uColor);
          vec3 ink = uBg;
          vec3 rgb = mix(ink, outCol, glyph);

          // Paint a fraction of the cell colour into the empty part of the cell.
          // Glyphs only ink a small part of their box, so without this fill the
          // frame averages ~5-9x darker than the raw scene and large areas go
          // pure black. Kept below full strength so glyphs keep their contrast.
          rgb += outCol * uFill * (1.0 - glyph);

          // subtle additive glow from bloom
          rgb += outCol * bloom * uBloom * 0.18;

          // screen effects
          float scan = 1.0 - uScanline * step(0.5, fract(px.y * 0.5));
          rgb *= scan;

          float vign = smoothstep(0.95, 0.35, length(vUv - 0.5));
          rgb *= mix(1.0, vign, uVignette);

          float n = (hash(px + uTime) - 0.5) * uNoise;
          rgb += n;

          float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 60.0));
          rgb *= flick;

          // damage vignette
          rgb = mix(rgb, vec3(0.9, 0.05, 0.15), uHit * smoothstep(0.2, 0.7, length(vUv - 0.5)));

          gl_FragColor = vec4(rgb, 1.0);
        }
      `,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // Bright-pass extraction material (for bloom)
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: 0.98 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tScene; uniform float uThreshold;
        void main(){
          vec3 c = texture2D(tScene, vUv).rgb;
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          float k = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.001);
          gl_FragColor = vec4(c * k, 1.0);
        }
      `,
    });
    this.brightQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.brightQuad.frustumCulled = false;
    this.brightScene = new THREE.Scene();
    this.brightScene.add(this.brightQuad);

    this._blurTargets = [];
    this.setSize(1, 1);
  }

  setPixelRatio(_pr) { /* ASCII resolution is independent of DPR */ }

  setSize(w, h) {
    const cellsX = Math.max(2, Math.floor(w / this.charSize));
    const cellsY = Math.max(2, Math.floor(h / this.charSize));
    // Render internal buffer at `resMult`x the character grid so small bright
    // features (enemy markers, tracers, muzzle flashes) survive the downsample.
    const rw = Math.floor(cellsX * this.resMult);
    const rh = Math.floor(cellsY * this.resMult);
    this.rt.setSize(rw, rh);
    this.brightRT.setSize(rw, rh);
    this.material.uniforms.uResolution.value.set(rw, rh);
    // Cell size expressed in *render-target* pixels (== 2).
    this.cellPx = rw / cellsX;
    this.material.uniforms.uCharSize.value = this.cellPx;
  }

  render(scene, camera, time) {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const u = this.material.uniforms;
    u.uTime.value = time || 0;
    u.uCharSize.value = this.cellPx || 2;

    // 1. scene -> rt
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // 2. bright pass
    this.brightMat.uniforms.tScene.value = this.rt.texture;
    this.renderer.setRenderTarget(this.brightRT);
    this.renderer.clear();
    this.renderer.render(this.brightScene, this.quadCam);

    // 3. compose to screen
    this.material.uniforms.tScene.value = this.rt.texture;
    this.material.uniforms.tBright.value = this.brightRT.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  setRamp(densityRamp) {
    this.densityRamp = densityRamp;
    this.ramp = fullRamp(densityRamp);
    this.densityLen = densityRamp.length;
    this.edgeBase = this.densityLen;
    const old = this.fontTexture;
    const tex = makeFontAtlas(this.ramp, 32);
    this.fontTexture = tex;
    this.fontCols = tex.userData.cols;
    this.fontRows = tex.userData.rows;
    const u = this.material.uniforms;
    u.tFont.value = tex;
    u.uFontCols.value = this.fontCols;
    u.uFontRows.value = this.fontRows;
    u.uRampLen.value = this.ramp.length;
    u.uDensityLen.value = this.densityLen;
    u.uEdgeBase.value = this.edgeBase;
    if (old && old !== tex && old.dispose) old.dispose();
  }

  setHit(v) { this.material.uniforms.uHit.value = v; }
}

/**
 * Build a monochrome glyph atlas on a 2D canvas. One glyph per cell.
 * The red channel carries the mask so the shader can index with .r.
 */
export function makeFontAtlas(ramp, cell = 32) {
  const cols = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(ramp.length))));
  // widen to keep power-of-two-ish, but arbitrary is fine for a CanvasTexture
  const rows = Math.ceil(ramp.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.floor(cell * 0.9)}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < ramp.length; i++) {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    ctx.fillText(ramp[i], cx, cy + cell * 0.03);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: the compose pass samples each glyph on its own cell, and
  // mipmapping only blurred the strokes. Linear filtering keeps them crisp.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData = { cols, rows };
  return tex;
}

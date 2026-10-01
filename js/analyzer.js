/* =========================================================
 * analyzer.js — Tool #2: FILE ATTACHMENT ANALYZER
 *             + offline "web search" reasoning engine.
 * Parses attached files locally (no upload):
 *   - text/json/csv → spec extraction (dimensions, colors, counts)
 *   - OBJ          → vertex/parts/extent statistics
 *   - STL (binary/ascii) → triangle count & bbox
 *   - GLB/GLTF     → header validation, node/anim counts
 *   - images       → dominant-color palette via canvas sampling
 * Produces Evidence objects the Planner consumes to bias
 * archetype, palette and scale of the generated model.
 * ======================================================= */
(function () {
  'use strict';

  const Analyzer = window.Analyzer = {
    /** dispatch by filename/type; returns Promise<Evidence[]> */
    async ingest(file) {
      const name = file.name.toLowerCase();
      let ev = null;
      try {
        if (name.endsWith('.obj')) ev = await this.fromOBJ(file);
        else if (name.endsWith('.stl')) ev = await this.fromSTL(file);
        else if (name.endsWith('.glb') || name.endsWith('.gltf')) ev = await this.fromGLB(file);
        else if (/\.(png|jpe?g|webp|gif|bmp)$/.test(name) || file.type.startsWith('image/')) ev = await this.fromImage(file);
        else ev = await this.fromText(file); // txt md json csv anything
      } catch (e) {
        ev = { file: file.name, kind: 'error', notes: ['Parse failed: ' + e.message], evidence: [] };
      }
      ev.sizeKB = (file.size / 1024).toFixed(1);
      return ev;
    },

    /* ---------------- OBJ ---------------- */
    async fromOBJ(file) {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      let v = 0, vn = 0, vt = 0, f = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
      const groups = new Set();
      for (const ln of lines) {
        if (ln.startsWith('v ')) {
          const p = ln.split(/\s+/); v++;
          const x = +p[1], y = +p[2], z = +p[3];
          if (isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
          if (isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          if (isFinite(z)) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
        } else if (ln.startsWith('vn ')) vn++;
        else if (ln.startsWith('vt ')) vt++;
        else if (ln.startsWith('f ')) f++;
        else if (/^(g|o)\s/.test(ln)) groups.add(ln.split(/\s+/)[1]);
      }
      const ext = { x: +(maxX - minX).toFixed(2), y: +(maxY - minY).toFixed(2), z: +(maxZ - minZ).toFixed(2) };
      const ratio = ext.y > 0 ? ext.x / ext.y : 1;
      const guess = classifyShape(ext, f);
      return {
        file: file.name, kind: 'mesh/obj',
        summary: `${v} verts · ${f} faces · ${groups.size || 1} groups`,
        dims: `extent X ${ext.x} × Y ${ext.y} × Z ${ext.z}`,
        notes: [`aspect (W/H) ≈ ${ratio.toFixed(2)}`, `triangulated faces ≈ ${f * 2}`],
        evidence: [{ type: 'shapeHint', value: guess }, { type: 'scaleHint', value: Math.max(ext.x, ext.y, ext.z) / 2 }],
      };
    },

    /* ---------------- STL ---------------- */
    async fromSTL(file) {
      const buf = await file.arrayBuffer();
      const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 80)));
      let tris = 0, ext = { x: 0, y: 0, z: 0 };
      if (head.startsWith('solid') && /\bfacet\b/.test(head)) {
        const text = new TextDecoder().decode(new Uint8Array(buf));
        tris = (text.match(/facet normal/gi) || []).length;
        const vs = [...text.matchAll(/vertex\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/g)];
        ext = extentFrom(vs.map(m => [+m[1], +m[2], +m[3]]));
      } else {
        const dv = new DataView(buf);
        tris = dv.getUint32(80, true);
        const n = Math.min(tris, 65535);
        const pts = [];
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50;
          for (let k = 0; k < 3; k++) {
            const b = o + 12 + k * 12;
            if (b + 12 > buf.byteLength) break;
            pts.push([dv.getFloat32(b, true), dv.getFloat32(b + 4, true), dv.getFloat32(b + 8, true)]);
          }
        }
        ext = extentFrom(pts);
      }
      const guess = classifyShape(ext, tris);
      return {
        file: file.name, kind: 'mesh/stl',
        summary: `${tris.toLocaleString()} triangles`,
        dims: `extent X ${ext.x.toFixed(2)} × Y ${ext.y.toFixed(2)} × Z ${ext.z.toFixed(2)}`,
        notes: ['watertight printable mesh detected'],
        evidence: [{ type: 'shapeHint', value: guess }],
      };
    },

    /* ---------------- GLB / glTF ---------------- */
    async fromGLB(file) {
      const buf = await file.arrayBuffer();
      const dv = new DataView(buf);
      const magic = dv.getUint32(0, true);
      const ver = dv.getUint32(4, true);
      let jsonChunk = null;
      if (magic === 0x46546C67) {
        const clen = dv.getUint32(12, true);
        jsonChunk = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.slice(20, 20 + clen))));
      } else {
        jsonChunk = JSON.parse(await file.text()); // .gltf json
      }
      const nodes = (jsonChunk.nodes || []).length;
      const meshes = (jsonChunk.meshes || []).length;
      const anims = (jsonChunk.animations || []).length;
      const skins = (jsonChunk.skins || []).length;
      const mats = (jsonChunk.materials || []).length;
      return {
        file: file.name, kind: 'mesh/glb',
        summary: `glTF v${ver} · ${nodes} nodes · ${meshes} meshes · ${skins} skins · ${anims} animations`,
        dims: `materials: ${mats}`,
        notes: [anims ? 'reference contains animation data → rig clips will be mirrored' : 'static reference mesh'],
        evidence: [{ type: 'rigRef', value: anims }, { type: 'materialCount', value: mats }],
      };
    },

    /* ---------------- image → palette ---------------- */
    async fromImage(file) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => {
          const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
        });
        const c = document.createElement('canvas');
        const S = 64; c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        const buckets = {};
        let rA = 0, gA = 0, bA = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          rA += d[i]; gA += d[i + 1]; bA += d[i + 2]; n++;
          const key = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
          buckets[key] = (buckets[key] || 0) + 1;
        }
        const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([k]) => {
            const r = (((k >> 6) & 7) * 32 + 16), g = (((k >> 3) & 7) * 32 + 16), b = ((k & 7) * 32 + 16);
            return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
          });
        const avg = n ? '#' + [rA / n, gA / n, bA / n].map(x => Math.round(x).toString(16).padStart(2, '0')).join('') : '#888888';
        return {
          file: file.name, kind: 'image',
          summary: `${img.naturalWidth}×${img.naturalHeight}px · sampled palette`,
          dims: 'dominant colors: ' + top.join(' '),
          notes: ['palette extracted locally — use as material recipe source'],
          evidence: [{ type: 'palette', value: top[0] || avg }, { type: 'paletteAlt', value: top[1] || avg }],
        };
      } finally { URL.revokeObjectURL(url); }
    },

    /* ---------------- text / json / csv specs ---------------- */
    async fromText(file) {
      const text = (await file.text()).slice(0, 20000);
      const ev = [];
      const lower = text.toLowerCase();

      // dimension patterns: "height: 4.2 m", "w=120cm"
      const dimRe = /(height|width|length|depth|span|size)\D{0,3}([\d.]+)\s*(m|cm|mm|ft|in)?/gi;
      let m, dims = [];
      while ((m = dimRe.exec(text))) dims.push(`${m[1]}=${m[2]}${m[3] || ''}`);
      if (dims.length) ev.push({ type: 'specDims', value: dims.slice(0, 6).join(', ') });

      // explicit color words
      for (const [w, hex] of Object.entries(Planner.COLORS)) {
        if (new RegExp('\\b' + w + '\\b').test(lower)) { ev.push({ type: 'palette', value: hex }); break; }
      }
      // hex codes in text
      const hx = text.match(/#[0-9a-fA-F]{6}/g);
      if (hx) ev.push({ type: 'palette', value: hx[0] });

      // part counts
      const cnt = lower.match(/(\d+)\s*(legs?|towers?|wheels?|blades?|wings?)/g);
      if (cnt) ev.push({ type: 'counts', value: cnt.slice(0, 4).join('; ') });

      // archetype keyword hit inside the doc
      const scored = scoreLocal(text);
      if (scored) ev.push({ type: 'shapeHint', value: scored });

      return {
        file: file.name, kind: 'text/spec',
        summary: `${text.split(/\s+/).length} tokens analyzed`,
        dims: dims.length ? dims.slice(0, 4).join(' · ') : 'no numeric dimensions found',
        notes: [ev.length ? `extracted ${ev.length} reasoning signals` : 'no structured signals — used as style context'],
        evidence: ev,
      };
    },

    /* ---------- web-search-style reasoning over local corpus ---------- */
    search(query) {
      const q = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
      const results = [];
      for (const fact of Knowledge.FACTS) {
        const hay = (fact.topic + ' ' + fact.body + ' ' + fact.tags.join(' ')).toLowerCase();
        let s = 0;
        for (const w of q) {
          if (hay.includes(w)) s++;
          if (fact.tags.some(t => t.includes(w))) s += 1.5;
          if (fact.topic.toLowerCase().includes(w)) s += 2;
        }
        if (s > 0) results.push({ ...fact, score: s });
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, 5);
    },

    /** convert search hits into planner evidence */
    searchEvidence(query) {
      const hits = this.search(query);
      const ev = [];
      for (const h of hits) {
        const num = h.body.match(/([\d.]+)\s*(?:–|-)?\s*([\d.]*)\s*(m|cm)/);
        if (num) ev.push({ type: 'refScale', value: parseFloat(num[1]) });
        ev.push({ type: 'fact', value: h.topic });
      }
      return { hits, ev };
    },
  };

  function extentFrom(pts) {
    if (!pts.length) return { x: 0, y: 0, z: 0 };
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of pts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
    return { x: mx[0] - mn[0], y: mx[1] - mn[1], z: mx[2] - mn[2] };
  }

  function classifyShape(ext, faces) {
    const { x, y, z } = ext;
    const max = Math.max(x, y, z) || 1;
    const nx = x / max, ny = y / max, nz = z / max;
    if (ny > 0.85 && nx < 0.5 && nz < 0.5) return 'building';
    if (nx > 0.9 && nz > 0.9 && ny < 0.4) return 'ufoCraft';
    if (nz > 0.9 && ny < 0.55) return faces > 900 ? 'vehicle' : 'aircraft';
    if (nx > 0.95 && ny > 0.8 && faces < 300) return 'weaponblade';
    if (nx > 0.8 && ny > 0.8 && nz > 0.8) return faces > 1500 ? 'tree' : 'bipedal';
    return 'quadruped';
  }

  function scoreLocal(text) {
    const best = Planner.plan(text, {}, []).archetype;
    return best || null;
  }
})();

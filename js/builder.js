/* =========================================================
 * builder.js — Tool #4: MODEL BUILDER
 * Blueprint JSON → THREE.Group of skinned-ready meshes.
 * Handles repeat modes: mirror, count-in-row (legs),
 * legsAround (radial), wheelPositions, cornerPositions,
 * gridRepeat, ridgeAlong, radialCount, triple, wallPerimeter,
 * crenelRing, braceRing, taper, opacity.
 * Deterministic per bp.seed (seeded RNG variation).
 * Returns { group, parts[], stats } where each part entry is
 * { mesh, jointName, kind, pos } for the Joints Applier.
 * ======================================================= */
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- geometry factories ---------- */
  function makeGeometry(kind, p, bp, rng) {
    const sr = Math.max(4, bp.segRadial || 12);
    const sa = Math.max(3, bp.segAxial || 12);
    const jit = (v, amt) => v * (1 + (rng() - 0.5) * amt); // organic micro-variation
    switch (kind) {
      case 'box':
        return new THREE.BoxGeometry(jit(p.w, 0.04), jit(p.h, 0.04), jit(p.d, 0.04));
      case 'sphere':
        return new THREE.SphereGeometry(p.r, sr, Math.max(4, sr >> 1));
      case 'capsule': {
        // capsule along Y: cylinder + 2 hemispheres merged visually via group? Use single lathe-free approach: CylinderGeometry with rounded caps approximated by scaling sphere. THREE r128 has no CapsuleGeometry → compose manually.
        const geo = composeCapsule(p.r, p.len, sr);
        return geo;
      }
      case 'cylinder': {
        if (p.taper !== undefined && p.taper !== 1) {
          return new THREE.CylinderGeometry(p.r * p.taper, p.r, p.h, sr, 1);
        }
        return new THREE.CylinderGeometry(p.r, p.r, p.h, sr, 1);
      }
      case 'cone':
        return new THREE.ConeGeometry(p.r, p.h, sr, 1);
      case 'torus':
        return new THREE.TorusGeometry(p.R, p.r, Math.max(6, sr >> 1), sr * 2);
      default:
        return new THREE.BoxGeometry(0.3, 0.3, 0.3);
    }
  }

  /** merge cylinder + hemispheres into one buffer geometry (Y-axis capsule) */
  function composeCapsule(r, len, seg) {
    const cylH = Math.max(0.01, len - 2 * r);
    const parts = [
      new THREE.CylinderGeometry(r, r, cylH, seg, 1, true),
      shiftedSphere(r, seg, 0, cylH / 2, 0),
      shiftedSphere(r, seg, 0, -cylH / 2, 0),
    ];
    return mergeGeometries(parts);
  }
  function shiftedSphere(r, seg, x, y, z) {
    const s = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, y >= 0 ? 0 : Math.PI / 2, Math.PI / 2);
    s.translate(x, y, z);
    return s;
  }

  /** minimal non-indexed geometry merge (positions+normals only) */
  function mergeGeometries(geos) {
    const nonIndexed = geos.map(g => g.toNonIndexed());
    let total = 0;
    nonIndexed.forEach(g => { total += g.attributes.position.count; });
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    let off = 0;
    for (const g of nonIndexed) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
  }

  /* ---------- material factory ---------- */
  function roleColor(role, bp) {
    const pal = Knowledge.PALETTES[bp.style] || null;
    if (role === 'primary' && bp.palette && bp.palette.primary) return bp.palette.primary;
    if (pal && pal[role]) return pal[role];
    return Knowledge.ROLE_COLORS[role] || '#8fa3bf';
  }

  function makeMaterial(part, bp) {
    const mt = bp.materialTweak || {};
    const col = roleColor(part.role || 'primary', bp);
    const glow = part.role === 'glow';
    const glass = part.role === 'glass';
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col),
      metalness: clampN((part.role === 'metal' ? 0.85 : part.role === 'dark' ? 0.4 : 0.15) + (mt.metalness || 0), 0, 1),
      roughness: clampN((glass ? 0.15 : part.role === 'glow' ? 0.3 : 0.6) + (mt.roughness || 0), 0.05, 1),
      emissive: new THREE.Color(glow ? col : '#000000'),
      emissiveIntensity: glow ? (0.85 + (mt.emissive || 0)) : (part.emissive || 0) + (mt.emissive || 0) * 0.4,
      transparent: glass || part.opacity !== undefined,
      opacity: part.opacity !== undefined ? part.opacity : (glass ? 0.55 : 1.0),
      flatShading: bp.style === 'lowpoly',
    });
    return mat;
  }

  function clampN(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- placement expansion ---------- */
  // returns array of {pos, rot, scaleX} instances for one blueprint part
  function expandPart(pt) {
    const basePos = pt.pos || [0, 0, 0];
    const baseRot = pt.rot || [0, 0, 0];
    const out = [];
    const push = (x, y, z, rzSign, sx) => out.push({ pos: [x, y, z], rot: [baseRot[0], baseRot[1], baseRot[2] * rzSign], sx: sx || 1 });

    if (pt.wheelPositions) { pt.wheelPositions.forEach(w => push(w[0], w[1], w[2], 1)); return out; }
    if (pt.cornerPositions) { pt.cornerPositions.forEach(c => push(c[0], c[1], c[2], 1)); return out; }

    if (pt.wallPerimeter) {
      // four walls forming a ring around center using current half extent
      const s = 1.05;
      push(0, basePos[1], basePos[2], 1);                       // front
      push(0, basePos[1], -basePos[2], 1);                      // back
      push(basePos[2] * s, basePos[1], 0, 1);                   // right (rotated below)
      push(-basePos[2] * s, basePos[1], 0, 1);                  // left
      out[2].rot = [0, Math.PI / 2, 0]; out[3].rot = [0, Math.PI / 2, 0];
      return out;
    }
    if (pt.crenelRing) {
      const n = 14, R = 1.05;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (i % 2) continue;
        push(Math.sin(a) * R * basePos[2] * 2, basePos[1], Math.cos(a) * R * basePos[2] * 2, 1);
      }
      return out;
    }
    if (pt.braceRing) {
      push(basePos[0], basePos[1], basePos[2], 1);
      push(basePos[0], basePos[1], -basePos[2], 1);
      const a = out[0]; out.push({ pos: [basePos[2], basePos[1], 0], rot: [0, Math.PI / 2, 0], sx: 1 });
      out.push({ pos: [-basePos[2], basePos[1], 0], rot: [0, Math.PI / 2, 0], sx: 1 });
      return out;
    }
    if (pt.legCorners) {
      const c = basePos[0], z = basePos[2];
      push(c, basePos[1], z, 1); push(-c, basePos[1], z, 1);
      push(c, basePos[1], -z, 1); push(-c, basePos[1], -z, 1);
      return out;
    }
    if (pt.legsAround) {
      const n = pt.legsAround;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const side = i % 2 === 0 ? 1 : -1;
        push(Math.sin(a) * Math.abs(basePos[0]), basePos[1], Math.cos(a) * Math.abs(basePos[2]) * 1.6, side);
      }
      return out;
    }
    if (pt.ridgeAlong) {
      const cnt = pt.ridgeCount || 6;
      const span = pt.ridgeSpan || 1.2;
      for (let i = 0; i < cnt; i++) {
        const f = (i / (cnt - 1)) - 0.5;
        const sc = 1 - Math.abs(f) * 0.7; // fade toward ends
        push(basePos[0], basePos[1], basePos[2] + f * span, 1, sc);
      }
      return out;
    }
    if (pt.gridRepeat) {
      const gr = pt.gridRepeat;
      for (let face = 0; face < (gr.faces || 1); face++) {
        for (let i = 0; i < gr.count; i++) {
          const off = (i - (gr.count - 1) / 2) * gr.step;
          if (gr.axis === 'x') push(basePos[0] + off, basePos[1], basePos[2], 1);
          else push(basePos[0], basePos[1], basePos[2] + off, 1);
        }
        if (gr.faces > 1 && face === 1) {
          // mirror to back side
          const l = out.length;
          for (let k = l - gr.count; k < l; k++) out[k] = { ...out[k], pos: [out[k].pos[0], out[k].pos[1], -(basePos[2]) + (out[k].pos[2] - basePos[2])] };
        }
      }
      return out;
    }
    if (pt.radialCount) {
      const n = pt.radialCount;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        push(Math.cos(a) * Math.abs(basePos[0]) * 2.4, basePos[1], Math.sin(a) * Math.abs(basePos[2]) * 2.4, 1);
      }
      return out;
    }
    if (pt.triple) {
      const tp = pt.triple;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * tp.step;
        if (tp.axis === 'x') push(basePos[0] + off, basePos[1], basePos[2], 1);
        else push(basePos[0], basePos[1], basePos[2] + off, 1);
      }
      return out;
    }
    if (pt.count && pt.pairZ !== undefined) {
      // quadruped-style legs: distribute N legs along ±X and ±Z
      const n = pt.count;
      const xs = [Math.abs(basePos[0]), -Math.abs(basePos[0])];
      const zs = [Math.abs(pt.pairZ), -Math.abs(pt.pairZ)];
      const slots = [];
      for (let i = 0; i < n; i++) slots.push(xs[i % 2], xs[i % 2]);
      // simpler: alternate sides front/back
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const frontBack = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
        push(side * Math.abs(basePos[0]), basePos[1], frontBack * Math.abs(pt.pairZ), 1);
      }
      return out;
    }

    // plain instance (+ mirror)
    push(basePos[0], basePos[1], basePos[2], 1);
    if (pt.mirror) push(-basePos[0], basePos[1], basePos[2], -1);
    return out;
  }

  /* ---------- public build ---------- */
  window.Builder = {
    /**
     * build(bp) -> {group, entries, stats}
     * entries: [{mesh, joint}] used later by Joints applier.
     */
    build(bp) {
      const rng = mulberry32(bp.seed || 12345);
      const group = new THREE.Group();
      group.name = 'FORGE_MODEL';
      const entries = [];
      let verts = 0, tris = 0, meshCount = 0;

      for (const pt of bp.parts) {
        const geo = makeGeometry(pt.kind, pt.p || {}, bp, rng);
        const mat = makeMaterial(pt, bp);
        const placements = expandPart(pt);
        for (const pl of placements) {
          const mesh = new THREE.Mesh(geo.clone(), mat.clone());
          mesh.name = (pt.id || 'part') + '_' + meshCount;
          mesh.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
          mesh.rotation.set(pl.rot[0], pl.rot[1], pl.rot[2]);
          if (pl.sx !== 1) mesh.scale.setScalar(pl.sx);
          mesh.userData.joint = pt.parent || 'root';
          mesh.userData.partId = pt.id;
          group.add(mesh);
          entries.push({ mesh, joint: pt.parent || 'root' });
          meshCount++;
          verts += geo.attributes.position.count;
          tris += geo.attributes.position.count / 3;
        }
        geo.dispose(); mat.dispose();
      }

      // global transforms from blueprint
      group.scale.setScalar(bp.globalScale || 1);
      group.rotation.y = THREE.MathUtils.degToRad(bp.rotateY || 0);

      // lift so nothing sits below ground plane
      const bbox = new THREE.Box3().setFromObject(group);
      if (bbox.min.y < -0.001) group.position.y -= bbox.min.y;

      return {
        group, entries,
        stats: {
          meshes: meshCount,
          vertices: Math.round(verts * (bp.globalScale || 1)),
          triangles: Math.round(tris),
          parts: bp.parts.length,
          joints: bp.joints.length,
        },
      };
    },
  };
})();

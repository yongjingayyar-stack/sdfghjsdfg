/* =========================================================
 * blueprinter.js — Tool #3: MODEL BLUEPRINTER
 * Turns a Plan into a Blueprint = { parts[], joints[], meta }.
 *  - deep-clones archetype recipe
 *  - applies detail level (segment density)
 *  - applies leg/tower overrides
 *  - materializes ADDONS (wings/horns/spikes/…) as new parts
 *  - derives joint chain + animation clips metadata
 * Also: applyOps(blueprint, ops) mutates a blueprint for the
 * Adjustment Applier (reversible history lives in slot.adjustments).
 * Blueprint is pure JSON → persistable & re-buildable.
 * ======================================================= */
(function () {
  'use strict';

  const DETAIL_SEG = { coarse: [6, 8], standard: [10, 14], high: [16, 20], ultra: [24, 32] };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- addon part factories ---------- */
  // Each returns array of parts to append. `bp` gives current bounds.
  const ADDON_BUILDERS = {
    wings(bp) {
      const y = bp.meta.topY * 0.75 || 1.0;
      const jn = pickJoint(bp, ['chest', 'bodyJ', 'torso', 'spine', 'body', 'root']);
      return [
        { id: 'wingL', kind: 'box', p: { w: 1.15, h: 0.05, d: 0.6 }, pos: [0.68, y, -0.05], rot: [0, 0, 0.28], role: 'secondary', mirror: true, parent: jn, addon: 'wings' },
        { id: 'wingBoneL', kind: 'cylinder', p: { r: 0.04, h: 1.1 }, pos: [0.66, y + 0.12, -0.05], rot: [0, 0, Math.PI / 2 - 0.28], role: 'dark', mirror: true, parent: jn, addon: 'wings' },
      ];
    },
    horns(bp) {
      const hy = (bp.meta.headY || 1.2) + 0.15;
      const hz = bp.meta.headZ || 0.6;
      const jn = pickJoint(bp, ['head', 'headJ']);
      return [
        { id: 'hornL', kind: 'cone', p: { r: 0.06, h: 0.34 }, pos: [0.14, hy, hz], rot: [-0.4, 0, 0.3], role: 'accent', mirror: true, parent: jn, addon: 'horns' },
      ];
    },
    spikes(bp) {
      const top = bp.meta.topY || 1.0;
      return [
        { id: 'backSpikes', kind: 'cone', p: { r: 0.06, h: 0.22 }, pos: [0, top + 0.02, 0.5], role: 'accent', ridgeAlong: 'z', ridgeCount: 8, ridgeSpan: bp.meta.lenZ || 1.4, parent: pickJoint(bp, ['spine', 'body', 'spineJ', 'root']), addon: 'spikes' },
      ];
    },
    tail(bp) {
      const ty = bp.meta.topY * 0.7 || 0.7;
      return [
        { id: 'addonTail', kind: 'cone', p: { r: 0.1, h: 0.85 }, pos: [0, ty, -(bp.meta.backZ || 0.7) - 0.3], rot: [-Math.PI / 2.4, 0, 0], role: 'limb', parent: pickJoint(bp, ['tail', 'tailJ', 'hips', 'root']), addon: 'tail' },
      ];
    },
    wheels(bp) {
      const r = Math.max(0.22, (bp.meta.halfW || 0.5) * 0.55);
      const x = (bp.meta.halfW || 0.5) + r * 0.35;
      const zF = (bp.meta.lenZ || 1.0) * 0.62, zB = -(bp.meta.lenZ || 1.0) * 0.62;
      const positions = [[x, r, zF], [-x, r, zF], [x, r, zB], [-x, r, zB]];
      return [
        { id: 'addWheel', kind: 'cylinder', p: { r: r, h: r * 0.6 }, pos: positions[0], rot: [0, 0, Math.PI / 2], role: 'dark', wheelPositions: positions, parent: 'root', addon: 'wheels' },
        { id: 'addHub', kind: 'cylinder', p: { r: r * 0.4, h: r * 0.65 }, pos: positions[0], rot: [0, 0, Math.PI / 2], role: 'metal', wheelPositions: positions, parent: 'root', addon: 'wheels' },
      ];
    },
    treads(bp) {
      const x = (bp.meta.halfW || 0.6) + 0.18;
      const len = (bp.meta.lenZ || 1.2) * 2.1;
      return [
        { id: 'treadL', kind: 'box', p: { w: 0.28, h: 0.34, d: len }, pos: [x, 0.2, 0], role: 'dark', parent: 'root', addon: 'treads' },
        { id: 'treadR', kind: 'box', p: { w: 0.28, h: 0.34, d: len }, pos: [-x, 0.2, 0], role: 'dark', parent: 'root', addon: 'treads' },
        { id: 'treadWheel', kind: 'cylinder', p: { r: 0.14, h: 0.3 }, pos: [x, 0.2, len / 2 - 0.2], rot: [0, 0, Math.PI / 2], role: 'metal', gridRepeat: { count: 3, axis: 'z', step: len / 2.6, faces: 2 }, parent: 'root', addon: 'treads' },
      ];
    },
    cannon(bp) {
      const y = bp.meta.topY * 0.9 || 1.0;
      return [
        { id: 'cannonBase', kind: 'cylinder', p: { r: 0.14, h: 0.2 }, pos: [0, y + 0.05, 0], role: 'metal', parent: pickJoint(bp, ['turretJ', 'torso', 'chest', 'root']) , addon: 'cannon' },
        { id: 'cannonBarrel', kind: 'cylinder', p: { r: 0.06, h: 1.1 }, pos: [0, y + 0.1, 0.6], rot: [Math.PI / 2, 0, 0], role: 'dark', parent: pickJoint(bp, ['turretJ', 'torso', 'chest', 'root']), addon: 'cannon' },
        { id: 'muzzleRing', kind: 'torus', p: { R: 0.08, r: 0.025 }, pos: [0, y + 0.1, 1.14], rot: [Math.PI / 2, 0, 0], role: 'glow', parent: pickJoint(bp, ['turretJ', 'torso', 'chest', 'root']), addon: 'cannon' },
      ];
    },
    antenna(bp) {
      const y = bp.meta.topY || 1.2;
      return [
        { id: 'mast', kind: 'cylinder', p: { r: 0.03, h: 0.7 }, pos: [0.1, y + 0.35, 0], role: 'metal', parent: pickJoint(bp, ['head', 'top', 'headJ', 'torso', 'root']), addon: 'antenna' },
        { id: 'dish', kind: 'sphere', p: { r: 0.14 }, pos: [0.1, y + 0.75, 0], scale: [1, 0.4, 1], role: 'glass', parent: pickJoint(bp, ['head', 'top', 'headJ', 'torso', 'root']), addon: 'antenna' },
        { id: 'beacon', kind: 'sphere', p: { r: 0.05 }, pos: [0.1, y + 0.92, 0], role: 'glow', parent: pickJoint(bp, ['head', 'top', 'headJ', 'torso', 'root']), addon: 'antenna' },
      ];
    },
    dome(bp) {
      const y = bp.meta.topY || 1.2;
      return [
        { id: 'domeShell', kind: 'sphere', p: { r: 0.45 }, pos: [0, y + 0.1, 0], scale: [1, 0.7, 1], role: 'glass', parent: pickJoint(bp, ['top', 'mid', 'torso', 'root']), addon: 'dome' },
      ];
    },
    towers(bp) {
      const s = Math.max(1.1, bp.meta.halfX || 1.0);
      const corners = [[s, s], [-s, s], [s, -s], [-s, -s]];
      return corners.map((c, i) => ({
        id: 'addTower' + i, kind: 'cylinder', p: { r: 0.3, h: 2.0 }, pos: [c[0], 1.0, c[1]], role: 'masonry', parent: 'root', addon: 'towers', towerIndex: i,
      })).concat(corners.map((c, i) => ({
        id: 'addTowerRoof' + i, kind: 'cone', p: { r: 0.38, h: 0.6 }, pos: [c[0], 2.3, c[1]], role: 'accent', parent: 'root', addon: 'towers',
      })));
    },
    flags(bp) {
      const y = bp.meta.topY || 1.5;
      return [
        { id: 'flagPoleA', kind: 'cylinder', p: { r: 0.025, h: 0.6 }, pos: [0, y + 0.3, 0], role: 'metal', parent: pickJoint(bp, ['top', 'gate', 'head', 'root']), addon: 'flags' },
        { id: 'flagCloth', kind: 'box', p: { w: 0.32, h: 0.2, d: 0.02 }, pos: [0.17, y + 0.48, 0], role: 'glow', parent: pickJoint(bp, ['top', 'gate', 'head', 'root']), addon: 'flags' },
      ];
    },
    crest(bp) {
      const hy = (bp.meta.headY || 1.2) + 0.18;
      const hz = bp.meta.headZ || 0.5;
      return [
        { id: 'crestRow', kind: 'cone', p: { r: 0.05, h: 0.18 }, pos: [0, hy, hz - 0.25], role: 'accent', ridgeAlong: 'z', ridgeCount: 5, ridgeSpan: 0.55, parent: pickJoint(bp, ['head', 'headJ']), addon: 'crest' },
      ];
    },
    armor(bp) {
      const y = bp.meta.topY * 0.85 || 1.0;
      return [
        { id: ' pauldronL', kind: 'sphere', p: { r: 0.2 }, pos: [(bp.meta.halfW || 0.5) + 0.1, y, 0], scale: [1, 0.7, 1], role: 'metal', mirror: true, parent: pickJoint(bp, ['armL', 'shoulder', 'chest', 'root']), addon: 'armor' },
        { id: 'breastPlate', kind: 'box', p: { w: (bp.meta.halfW || 0.5) * 1.6, h: 0.4, d: 0.08 }, pos: [0, y, (bp.meta.frontZ || 0.4) + 0.05], role: 'metal', parent: pickJoint(bp, ['chest', 'torso', 'bodyJ', 'root']), addon: 'armor' },
      ];
    },
    gloweyes(bp) {
      const hy = bp.meta.headY || 1.2;
      const hz = (bp.meta.headZ || 0.6) + (bp.meta.headR || 0.3) * 0.75;
      return [
        { id: 'glowEyeL', kind: 'sphere', p: { r: 0.05 }, pos: [0.1, hy + 0.03, hz], role: 'glow', mirror: true, emissive: 1.4, parent: pickJoint(bp, ['head', 'headJ']), addon: 'gloweyes' },
      ];
    },
    claws(bp) {
      const fy = 0.12;
      return [
        { id: 'clawSet', kind: 'cone', p: { r: 0.04, h: 0.14 }, pos: [0.3, fy, 0.28], rot: [Math.PI / 2, 0, 0], role: 'accent', triple: { axis: 'x', step: 0.1 }, parent: pickJoint(bp, ['legL', 'foot', 'root']), addon: 'claws' },
      ];
    },
    jets(bp) {
      const back = -(bp.meta.backZ || 0.9) - 0.15;
      const y = bp.meta.topY * 0.6 || 0.6;
      return [
        { id: 'jetPod', kind: 'cylinder', p: { r: 0.12, h: 0.4 }, pos: [0.4, y, back], rot: [Math.PI / 2, 0, 0], role: 'metal', mirror: true, parent: pickJoint(bp, ['engine', 'torso', 'root']), addon: 'jets' },
        { id: 'jetFlame', kind: 'cone', p: { r: 0.1, h: 0.35 }, pos: [0.4, y, back - 0.35], rot: [-Math.PI / 2, 0, 0], role: 'glow', emissive: 1.2, mirror: true, parent: pickJoint(bp, ['engine', 'torso', 'root']), addon: 'jets' },
      ];
    },
  };

  function pickJoint(bp, candidates) {
    for (const c of candidates) if (bp.joints.some(j => j[0] === c)) return c;
    return bp.joints.length ? bp.joints[0][0] : 'root';
  }

  /* ---------- bounds meta (for addon placement) ---------- */
  function computeMeta(parts) {
    let maxX = 0.3, maxY = 0.3, maxZ = 0.3, minX = 99, headY = null, headZ = null, headR = null;
    for (const pt of parts) {
      const p = pt.p || {};
      const halfW = (p.w || (p.r || 0.2) * 2) / 2;
      const halfH = (p.h || p.len || (p.r || 0.2) * 2) / 2;
      const halfD = (p.d || (p.r || 0.2) * 2) / 2;
      const pos = pt.pos || [0, 0, 0];
      maxX = Math.max(maxX, Math.abs(pos[0]) + halfW);
      maxY = Math.max(maxY, pos[1] + halfH);
      maxZ = Math.max(maxZ, Math.abs(pos[2]) + halfD);
      minX = Math.min(minX, pos[1] - halfH);
      if (/head/i.test(pt.id)) { headY = pos[1]; headZ = pos[2]; headR = p.r || p.w / 2; }
    }
    return {
      halfW: maxX, halfX: maxX, topY: maxY, bottomY: Math.max(0, minX),
      lenZ: maxZ, frontZ: maxZ, backZ: maxZ, headY, headZ, headR,
    };
  }

  window.Blueprinter = {
    /** plan -> blueprint JSON */
    fromPlan(plan) {
      const arch = Knowledge.ARCHETYPES[plan.archetype];
      const bp = {
        version: 2,
        archetype: plan.archetype,
        label: arch.label,
        style: plan.style,
        detail: plan.detail,
        addons: [],
        palette: plan.colors && plan.colors.primary ? { primary: plan.colors.primary } : {},
        globalScale: plan.scaleHint || 1.0,
        rotateY: 0,
        animSpeed: 1.0,
        materialTweak: { metalness: 0, roughness: 0, emissive: 0 },
        seed: Math.floor(Math.random() * 1e9),
        joints: clone(arch.joints),
        parts: clone(arch.parts),
      };

      // detail → tessellation hints stored on parts
      const seg = DETAIL_SEG[plan.detail] || DETAIL_SEG.standard;
      bp.segRadial = seg[0]; bp.segAxial = seg[1];

      // leg override (quadruped ↔ hexapod style regeneration)
      if (plan.legOverride) {
        bp.legCount = plan.legOverride;
        for (const pt of bp.parts) if (/^leg$|legPost/i.test(pt.id)) pt.count = plan.legOverride;
        const legsAroundParts = bp.parts.filter(p => p.legsAround);
        legsAroundParts.forEach(p => { p.legsAround = plan.legOverride; });
      }
      if (plan.towerOverride) bp.towerCount = plan.towerOverride;

      // addons
      bp.meta = computeMeta(bp.parts);
      for (const a of plan.addons) this.addAddon(bp, a);

      // remove default duplicate tails if user asked tail and archetype already has one etc. handled inside addAddon.

      bp.meta = computeMeta(bp.parts);
      bp.clips = deriveClips(bp);
      return bp;
    },

    addAddon(bp, name) {
      const fn = ADDON_BUILDERS[name];
      if (!fn) return false;
      if (bp.addons.includes(name)) return false; // idempotent
      bp.meta = computeMeta(bp.parts);
      const extra = fn(bp).map(p => ({ ...p, id: p.id.trim(), addon: name }));
      bp.parts.push(...extra);
      bp.addons.push(name);
      bp.meta = computeMeta(bp.parts);
      return true;
    },

    removeAddon(bp, name) {
      bp.parts = bp.parts.filter(p => p.addon !== name);
      bp.addons = bp.addons.filter(a => a !== name);
      bp.meta = computeMeta(bp.parts);
      return true;
    },

    /* ---------- adjustment ops application ---------- */
    applyOps(bp, ops) {
      const applied = [];
      for (const o of ops) {
        switch (o.op) {
          case 'scale':
            bp.globalScale = clamp((bp.globalScale || 1) * o.factor, 0.15, 8);
            applied.push(`global scale → ${bp.globalScale.toFixed(2)}×`); break;
          case 'param': {
            let n = 0;
            for (const pt of bp.parts) {
              if (o.part.test(pt.id) && pt.p && pt.p[o.key] !== undefined) { pt.p[o.key] = clampNum(pt.p[o.key] * o.mul, 0.02, 12); n++; }
            }
            applied.push(`${o.part.source} param ${o.key} ×${o.mul} (${n} parts)`); break;
          }
          case 'thickness':
            for (const pt of bp.parts) {
              if (pt.p) {
                if (pt.p.r !== undefined) pt.p.r = clampNum(pt.p.r * o.mul, 0.02, 6);
                if (pt.p.w !== undefined && /leg|arm|wing|tail|barrel|trunk/i.test(pt.id)) pt.p.w = clampNum(pt.p.w * o.mul, 0.02, 6);
              }
            }
            applied.push(`thickness ×${o.mul}`); break;
          case 'width':
            for (const pt of bp.parts) if (pt.p && pt.p.w !== undefined) pt.p.w = clampNum(pt.p.w * o.mul, 0.02, 8);
            applied.push(`width ×${o.mul}`); break;
          case 'heightScale':
            for (const pt of bp.parts) {
              if (pt.p && pt.p.h !== undefined) pt.p.h = clampNum(pt.p.h * o.mul, 0.02, 10);
              if (Array.isArray(pt.pos)) pt.pos[1] = pt.pos[1] * (o.mul ** 0.5);
            }
            applied.push(`height ×${o.mul}`); break;
          case 'length':
            for (const pt of bp.parts) {
              if (pt.p && pt.p.d !== undefined && /body|torso|hull|pod|chassis|seat/i.test(pt.id)) pt.p.d = clampNum(pt.p.d * o.mul, 0.02, 10);
              if (pt.p && pt.p.len !== undefined && /body|torso|hull|pod|chassis/i.test(pt.id)) pt.p.len = clampNum(pt.p.len * o.mul, 0.02, 10);
            }
            applied.push(`body length ×${o.mul}`); break;
          case 'addAddon': {
            const ok = this.addAddon(bp, o.addon);
            applied.push(ok ? `added ${o.addon}` : `${o.addon} already present`); break;
          }
          case 'removeAddon': {
            const had = bp.addons.includes(o.addon) || bp.parts.some(p => p.addon === o.addon);
            this.removeAddon(bp, o.addon);
            applied.push(had ? `removed ${o.addon}` : `no ${o.addon} to remove`); break;
          }
          case 'legCount': {
            bp.legCount = o.n;
            for (const pt of bp.parts) if (pt.count !== undefined && /leg|paw/i.test(pt.id)) pt.count = o.n;
            for (const pt of bp.parts) if (pt.legsAround) pt.legsAround = o.n;
            applied.push(`leg count → ${o.n}`); break;
          }
          case 'towerCount':
            bp.towerCount = o.n;
            applied.push(`tower count → ${o.n}`); break;
          case 'recolor':
            bp.palette = bp.palette || {};
            bp.palette.primary = o.hex;
            applied.push(`primary color → ${o.name}`); break;
          case 'emissiveBoost':
            bp.materialTweak.emissive = clamp(bp.materialTweak.emissive + o.amt, 0, 2);
            applied.push('emissive boost'); break;
          case 'roughnessUp':
            bp.materialTweak.roughness = clamp(bp.materialTweak.roughness + o.amt, -0.5, 0.8);
            applied.push('matte finish'); break;
          case 'metalnessUp':
            bp.materialTweak.metalness = clamp(bp.materialTweak.metalness + o.amt, -0.5, 0.9);
            applied.push('chrome finish'); break;
          case 'animSpeed':
            bp.animSpeed = clamp((bp.animSpeed || 1) * o.mul, 0.15, 4);
            applied.push(`anim speed → ${bp.animSpeed.toFixed(2)}×`); break;
          case 'animStop':
            bp.animSpeed = 0; applied.push('animation paused (rest pose)'); break;
          case 'detailUp':
            bp.segRadial = clamp(bp.segRadial + 6, 4, 40); bp.segAxial = clamp(bp.segAxial + 6, 4, 40);
            applied.push('tessellation up'); break;
          case 'detailDown':
            bp.segRadial = clamp(bp.segRadial - 4, 4, 40); bp.segAxial = clamp(bp.segAxial - 4, 4, 40);
            applied.push('tessellation down'); break;
          case 'rotateY':
            bp.rotateY = ((bp.rotateY || 0) + o.deg) % 360;
            applied.push(`rotated Y ${o.deg}°`); break;
          case 'note':
            bp.seed = Math.floor(Math.random() * 1e9);
            applied.push(o.msg); break;
          default: break;
        }
      }
      bp.meta = computeMeta(bp.parts);
      bp.clips = deriveClips(bp);
      return applied;
    },

    computeMeta,
  };

  /* ---------- animation clip derivation ---------- */
  function deriveClips(bp) {
    const names = bp.joints.map(j => j[0]);
    const has = (n) => names.includes(n);
    const clips = [{ name: 'Idle', duration: 3.2, speedMul: 1 }];
    if (has('legFL') || has('legL') || bp.legCount || has('legA')) clips.push({ name: 'Walk', duration: 1.6, speedMul: 1 });
    if (has('wingL') || bp.addons.includes('wings')) clips.push({ name: 'Fly', duration: 1.1, speedMul: 1.4 });
    if (has('tail') || has('tailJ') || bp.addons.includes('tail')) clips.push({ name: 'Swagger', duration: 2.4, speedMul: 0.8 });
    if (has('turretJ') || has('barrelJ')) clips.push({ name: 'Aim', duration: 4.0, speedMul: 0.6 });
    if (has('wheelFL')) clips.push({ name: 'Roll', duration: 2.0, speedMul: 1 });
    return clips;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
})();

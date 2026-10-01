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
    /** plan -> blueprint JSON. `spec` (optional) is the Detail-Fidelity spec:
     *  the actual form of the NAMED subject, materialized onto the scaffold. */
    fromPlan(plan, spec) {
      const archKey = (spec && spec.arch && Knowledge.ARCHETYPES[spec.arch]) ? spec.arch : plan.archetype;
      const arch = Knowledge.ARCHETYPES[archKey];
      const bp = {
        version: 2,
        archetype: archKey,
        label: (spec && spec.label) ? spec.label : arch.label,
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
      if (plan.detail === 'ultra') bp.segRadial = Math.max(bp.segRadial, 24);

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

      // ---- fidelity layer: named-subject spec drives real params ----
      if (spec) {
        bp.spec = clone(spec);
        this.applySpec(bp, spec);
      }

      // remove default duplicate tails if user asked tail and archetype already has one etc. handled inside addAddon.

      bp.meta = computeMeta(bp.parts);
      bp.clips = deriveClips(bp);
      return bp;
    },

    /* ---------- DETAIL FIDELITY MATERIALIZATION ----------
     * Turns spec.detail/palette/materials/dims into concrete part-graph
     * mutations so the model matches the ACTUAL FORM of the named subject. */
    applySpec(bp, spec) {
      const d = spec.detail || {};
      const applied = [];
      const clampV = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const mulParam = (re, key, f, lo, hi) => {
        let n = 0;
        for (const pt of bp.parts) {
          if (pt.p && pt.p[key] !== undefined && (!re || re.test(pt.id))) {
            pt.p[key] = clampV(pt.p[key] * f, lo == null ? 0.02 : lo, hi == null ? 12 : hi); n++;
          }
        }
        if (n) applied.push(`${key} ×${f.toFixed(2)} on ${n} parts`);
        return n;
      };
      const scalePosZ = (re, f) => {
        for (const pt of bp.parts) if (Array.isArray(pt.pos) && re.test(pt.id)) pt.pos[2] *= f;
      };

      /* -- counts -- */
      if (d.legCount) {
        bp.legCount = d.legCount;
        for (const pt of bp.parts) if (pt.count !== undefined && /leg|paw/i.test(pt.id)) pt.count = d.legCount;
        for (const pt of bp.parts) if (pt.legsAround) pt.legsAround = d.legCount;
        applied.push(`leg count → ${d.legCount}`);
      }
      if (d.towerCount) { bp.towerCount = d.towerCount; applied.push(`tower count → ${d.towerCount}`); }
      if (d.floorsHint) { bp.floors = d.floorsHint; applied.push(`storeys → ${d.floorsHint}`); }

      /* -- ears -- */
      if (d.earMode || d.earCount || d.earScale || d.pointedEars || d.roundEars || d.batEars) {
        const mode = d.earMode || (d.batEars ? 'batEars' : d.pointedEars ? 'pointed' : d.roundEars ? 'round' : 'longEars');
        const es = clampV((d.earScale || 1) * (mode === 'longEars' ? 1.8 : mode === 'flap' ? 2.2 : mode === 'batEars' ? 1.5 : 1), 0.5, 3);
        for (const pt of bp.parts) {
          if (!/ear/i.test(pt.id)) continue;
          pt.kind = (mode === 'round' || mode === 'flap') ? 'sphere' : 'cone';
          if (pt.kind === 'cone') { pt.p = { r: 0.07, h: 0.3 }; pt.rot = pt.rot || [0, 0, 0.3]; }
          else pt.p = { r: 0.1 };
          pt.earStyle = mode;
          pt.mirror = true;
        }
        if (mode === 'flap' || es > 1.6) {
          for (const pt of bp.parts) if (/ear/i.test(pt.id) && pt.p) {
            if (pt.p.r !== undefined) pt.p.r = clampV(pt.p.r * es, 0.03, 0.9);
            if (pt.p.h !== undefined) pt.p.h = clampV(pt.p.h * es, 0.05, 1.2);
          }
        }
        if (d.earCount && d.earCount !== 2) {
          const earParts = bp.parts.filter(p => /ear/i.test(p.id));
          if (earParts.length) {
            const proto = earParts[0];
            bp.parts = bp.parts.filter(p => !/ear/i.test(p.id));
            for (let i = 0; i < d.earCount; i++) {
              const e = clone(proto);
              e.id = 'ear' + i; e.mirror = false;
              const ang = (i / d.earCount) * Math.PI * 2;
              e.pos = [Math.cos(ang) * 0.18, proto.pos[1], proto.pos[2] + Math.sin(ang) * 0.12];
              bp.parts.push(e);
            }
          }
        }
        applied.push(`ear morphology → ${mode}`);
      }

      /* -- horns -- */
      if (d.hornCount || d.horns || d.curvedHorns || d.spiralHorn || d.hornNasal || d.threeHornSet) {
        const hy = (bp.meta.headY || 1.2), hz = (bp.meta.headZ || 0.5);
        const jn = pickJoint(bp, ['head', 'headJ']);
        const n = d.hornCount || (d.threeHornSet ? 3 : (d.horns || d.curvedHorns || d.spiralHorn || d.hornNasal) ? 2 : 0);
        if (n > 0 && !bp.parts.some(p => /^horn/i.test(p.id))) {
          for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
            bp.parts.push({
              id: 'horn' + i, kind: d.spiralHorn ? 'cylinder' : 'cone',
              p: d.spiralHorn ? { r: 0.05, h: 0.55 } : { r: 0.06, h: 0.4 },
              pos: [t * 0.22, hy + 0.16 + (d.threeHornSet && i === 2 ? 0.08 : 0), hz * (d.hornNasal ? 1.15 : 0.9)],
              rot: d.curvedHorns ? [-0.5, 0, t * 0.6] : [-0.3, 0, t * 0.5],
              role: 'accent', parent: jn, addon: 'horns', spiral: !!d.spiralHorn,
            });
          }
          bp.addons.push('horns');
          applied.push(`horn set → ${n}`);
        }
      }

      /* -- wings -- */
      if (d.wingCount || d.wings || d.featheredWings || d.batWings || d.flipperWings || d.quadRotorArms) {
        const want = d.wingCount || (d.quadRotorArms ? 4 : (d.wings || d.featheredWings || d.batWings || d.flipperWings) ? 2 : 0);
        if (want >= 2 && !bp.addons.includes('wings')) this.addAddon(bp, 'wings');
        const wingParts = bp.parts.filter(p => /wing/i.test(p.id));
        if (want >= 4 && wingParts.length) {
          const extra = [];
          for (const wp of wingParts.slice()) {
            const w2 = clone(wp); w2.id = wp.id + 'B'; w2.addon = 'wings';
            w2.pos = clone(wp.pos); w2.pos[1] -= 0.28; w2.pos[2] -= 0.35;
            if (w2.p) { if (w2.p.w) w2.p.w *= 0.75; if (w2.p.h) w2.p.h *= 0.75; if (w2.p.r) w2.p.r *= 0.75; }
            extra.push(w2);
          }
          bp.parts.push(...extra); applied.push('second wing pair added');
        }
        const span = clampV(d.wingSpanMul || 1, 0.5, 2.5);
        for (const wp of bp.parts) if (/wing/i.test(wp.id) && wp.p) {
          if (wp.p.d !== undefined) wp.p.d = clampV(wp.p.d * span, 0.05, 4);
          if (wp.p.h !== undefined && wp.kind === 'box') wp.p.h = wp.p.h; // keep thin
          if (Array.isArray(wp.pos)) wp.pos[0] = clampV(Math.abs(wp.pos[0]) * span, 0.1, 3) * Math.sign(wp.pos[0] || 1);
        }
        if (d.batWings || d.wingMembrane) { for (const wp of bp.parts) if (/wing/i.test(wp.id)) wp.role = 'dark'; applied.push('membrane wing surface'); }
        if (d.featheredWings) { for (const wp of bp.parts) if (/wing/i.test(wp.id)) { wp.feathers = 5; wp.role = 'secondary'; } applied.push('feather plating'); }
        if (d.flipperWings) {
          for (const wp of bp.parts) if (/wing/i.test(wp.id) && wp.p) {
            if (wp.p.d !== undefined) wp.p.d *= 0.5;
            if (wp.p.w !== undefined) wp.p.w *= 0.6;
            wp.rot = [0, 0, 1.2];
          }
          applied.push('flippers instead of airfoils');
        }
        if (span !== 1) applied.push(`wingspan ×${span.toFixed(2)}`);
      }

      /* -- tail -- */
      const tailKeys = ['tailLen','tailBushy','tailFlow','tailHeavy','tailThinLong','tailProp','tailBarbed','tailStiff','deathRollTail','curlyTail','stubbyTail','tailPompom','tailTuft','tailUp','noTail','spadeTail','prehensileTail','coil'];
      if (tailKeys.some(k => d[k])) {
        const ty = (bp.meta.topY || 1) * 0.65, back = -(bp.meta.backZ || 0.7);
        const jn = pickJoint(bp, ['tail', 'tailJ', 'hips', 'root']);
        if (!bp.parts.some(p => /^tail/i.test(p.id))) {
          bp.parts.push({ id: 'tail', kind: 'cone', p: { r: 0.09, h: 0.7 }, pos: [0, ty, back - 0.2], rot: [-Math.PI / 2.2, 0, 0], role: 'limb', mirror: false, parent: jn, addon: 'tail' });
          if (!bp.addons.includes('tail')) bp.addons.push('tail');
        }
        for (const tp of bp.parts) if (/^tail/i.test(tp.id) && tp.p) {
          if (d.tailLen) tp.p.h = clampV(tp.p.h * d.tailLen, 0.1, 3);
          if (d.tailHeavy) tp.p.r = clampV(tp.p.r * 1.5, 0.03, 0.6);
          if (d.tailThinLong) { tp.p.r = clampV(tp.p.r * 0.45, 0.015, 0.2); tp.p.h = clampV(tp.p.h * 1.6, 0.1, 3); }
          if (d.tailBushy) { tp.p.r = clampV(tp.p.r * d.tailBushy, 0.03, 0.7); tp.fluff = 1; }
          if (d.tailFlow) { tp.p.r = clampV(tp.p.r * 1.1, 0.03, 0.5); tp.flow = 1; }
          if (d.tailProp) { tp.p.h = clampV(tp.p.h * d.tailProp, 0.2, 3); tp.rot = [-Math.PI / 3.2, 0, 0]; }
          if (d.tailBarbed) tp.barbed = 1;
          if (d.tailStiff) tp.rot = [-Math.PI / 2, 0, 0];
          if (d.deathRollTail) tp.p.h = clampV(tp.p.h * 1.2, 0.2, 3);
          if (d.spadeTail) tp.spade = 1;
          if (d.prehensileTail) tp.prehensile = 1;
          if (d.coil) tp.coil = 1;
          if (d.tailUp) tp.rot = [-Math.PI / 3.4, 0, 0];
          if (d.curlyTail) { tp.curl = 1; tp.p.h = clampV(tp.p.h * 0.5, 0.08, 1); }
          if (d.stubbyTail || d.tailPompom) { tp.p.h = clampV(tp.p.h * 0.35, 0.05, 0.6); tp.p.r = clampV((tp.p.r || 0.08) * (d.tailPompom ? 1.4 : 1), 0.02, 0.3); }
          if (d.tailTuft) tp.tuft = 1;
          if (d.noTail) { bp.parts = bp.parts.filter(p => !/^tail/i.test(p.id)); }
        }
        if (d.tailWag) bp.tailWag = 1;
        applied.push('tail conformed to species form');
      }

      /* -- head / snout -- */
      if (d.snoutMul || d.headElong || d.longSnout || d.beak || d.headRound || d.headMass || d.bulbHead || d.skullHead || d.eagleHead) {
        for (const pt of bp.parts) {
          if (!/head/i.test(pt.id)) continue;
          const f = d.longSnout || d.snoutMul || (d.headElong || 1);
          if (f && pt.p) {
            if (pt.p.d !== undefined) pt.p.d = clampV(pt.p.d * f, 0.05, 4);
            if (pt.p.z !== undefined) pt.p.z = clampV(pt.p.z * f, 0.05, 4);
            if (pt.p.w !== undefined && d.headRound) pt.p.w = clampV(pt.p.w * d.headRound, 0.05, 3);
          }
          if (d.headMass && pt.p && pt.p.r !== undefined) pt.p.r = clampV(pt.p.r * d.headMass, 0.05, 2);
          if (d.bulbHead && pt.p && pt.p.r !== undefined) pt.p.r = clampV(pt.p.r * d.bulbHead, 0.05, 2);
          if (d.skullHead) pt.role = 'light';
        }
        const hy = bp.meta.headY || 1.1, hz = bp.meta.headZ || 0.5, hr = bp.meta.headR || 0.25;
        const jn = pickJoint(bp, ['head', 'headJ']);
        if ((d.snoutMul && d.snoutMul > 1.1) || d.longSnout || d.muzzleDark) {
          bp.parts.push({ id: 'snout', kind: 'box', p: { w: 0.16, h: 0.12, d: (d.longSnout || d.snoutMul || 1) * 0.4 }, pos: [0, hy - 0.05, hz + hr + 0.15], role: d.muzzleDark ? 'dark' : 'secondary', parent: jn, fidelity: 1 });
          applied.push('muzzle/snout extension');
        }
        if (d.beak || d.hookedBeak || d.slimBeak || d.curvedBeakBig || d.bill) {
          const s = d.curvedBeakBig ? 1.4 : d.slimBeak ? 0.7 : 1;
          bp.parts.push({ id: 'beak', kind: 'cone', p: { r: 0.07 * s, h: 0.26 * s }, pos: [0, hy - 0.02, hz + hr + 0.12], rot: [Math.PI / 2 + 0.35, 0, 0], role: 'accent', parent: jn, fidelity: 1 });
          applied.push('beak geometry');
        }
        if (d.trunk) {
          bp.parts.push({ id: 'trunk', kind: 'cylinder', p: { r: 0.07, h: 0.9 }, pos: [0, hy - 0.12, hz + hr * 0.7], rot: [0.5, 0, 0], role: 'limb', trunkSegments: 6, parent: jn, fidelity: 1 });
          applied.push('proboscis/trunk segments');
        }
        if (d.antlers) {
          bp.parts.push({ id: 'antlerL', kind: 'cylinder', p: { r: 0.03, h: 0.5 }, pos: [0.12, hy + 0.2, hz], rot: [-0.3, 0, 0.5], role: 'accent', branch: 3, mirror: true, parent: jn, fidelity: 1 });
          applied.push('branching antlers');
        }
        if (d.hump) { bp.parts.push({ id: 'hump', kind: 'sphere', p: { r: 0.28 }, pos: [0, (bp.meta.topY || 1) * 0.78, -0.1], scale: [1, 0.8, 1.2], role: 'secondary', parent: pickJoint(bp, ['spine', 'body', 'root']), fidelity: 1 }); applied.push('dorsal hump'); }
        if (d.shell || d.carapace || d.domeShell) {
          bp.parts.push({ id: 'shellCarapace', kind: 'sphere', p: { r: 0.55 }, pos: [0, (bp.meta.topY || 1) * 0.55, 0], scale: [1, d.shellDomed ? 0.75 : 0.5, 1.1], role: 'masonry', shell: 1, parent: pickJoint(bp, ['shell', 'body', 'root']), fidelity: 1 });
          applied.push('protective shell/carapace');
        }
        if (d.finDorsal || d.dorsalFin) {
          bp.parts.push({ id: 'dorsalFin', kind: 'cone', p: { r: 0.16, h: 0.34 }, pos: [0, (bp.meta.topY || 0.8) + 0.05, 0], scale: [0.3, 1, 1.4], role: 'secondary', parent: pickJoint(bp, ['body', 'spine', 'root']), fidelity: 1 });
          bp.parts.push({ id: 'tailFluke', kind: 'box', p: { w: 0.5, h: 0.05, d: 0.3 }, pos: [0, (bp.meta.topY || 0.8) * 0.6, -(bp.meta.backZ || 0.8) - 0.25], role: 'secondary', parent: pickJoint(bp, ['tail', 'body', 'root']), fidelity: 1 });
          applied.push('aquatic fin suite');
        }
        if (d.comb) bp.parts.push({ id: 'comb', kind: 'cone', p: { r: 0.04, h: 0.12 }, pos: [0, (bp.meta.headY || 1.2) + 0.16, bp.meta.headZ || 0.4], role: 'glow', ridgeAlong: 'z', ridgeCount: 3, ridgeSpan: 0.18, parent: pickJoint(bp, ['head', 'headJ']), fidelity: 1 });
        if (d.whiskers) bp.whiskers = 1;
        if (d.mane) {
          bp.parts.push({ id: 'mane', kind: 'torus', p: { R: 0.3, r: 0.12 }, pos: [0, (bp.meta.headY || 1.2) - 0.05, (bp.meta.headZ || 0.5) - 0.1], rot: [0.4, 0, 0], role: 'dark', mane: 1, parent: pickJoint(bp, ['head', 'neck', 'headJ', 'root']), fidelity: 1 });
          applied.push('mane collar');
        }
      }

      /* -- body proportions -- */
      if (d.neckLong) { mulParam(/neck/i, 'h', d.neckLong, 0.05, 4); scalePosZ(/head/i, 1 + (d.neckLong - 1) * 0.5); }
      if (d.bodyLen) mulParam(/body|torso|hull|abdomen|thorax/i, 'd', d.bodyLen, 0.05, 8);
      if (d.legScale) { mulParam(/leg|arm|thigh|shin|foot/i, 'h', d.legScale, 0.03, 4); mulParam(/leg|arm|thigh/i, 'r', Math.sqrt(d.legScale), 0.01, 1); }
      if (d.armScale) mulParam(/arm|forelimb/i, 'h', d.armScale, 0.03, 4);
      if (d.tinyArms) { mulParam(/arm/i, 'h', 0.4, 0.03, 4); mulParam(/arm/i, 'r', 0.8, 0.01, 1); applied.push('vestigial forelimbs'); }
      if (d.hindScale) mulParam(/leg|thigh/i, 'r', d.hindScale, 0.01, 1.2);
      if (d.bulky) { mulParam(/body|torso|abdomen/i, 'w', d.bulky, 0.05, 6); mulParam(/body|torso/i, 'd', Math.sqrt(d.bulky), 0.05, 8); }
      if (d.slender) { mulParam(/body|torso|abdomen/i, 'w', d.slender, 0.05, 6); }
      if (d.stocky) { mulParam(/body|torso/i, 'w', d.stocky, 0.05, 6); mulParam(/leg/i, 'r', d.stocky, 0.01, 1); }
      if (d.fluffy) { mulParam(null, 'r', d.fluffy, 0.01, 3); mulParam(/body|head/i, 'w', d.fluffy, 0.05, 6); bp.furCoat = 1; }
      if (d.barrelChest) mulParam(/chest|torso/i, 'w', d.barrelChest, 0.05, 6);
      if (d.wideStance) { for (const pt of bp.parts) if (Array.isArray(pt.pos) && /leg|arm|shoulder|hip/i.test(pt.id)) pt.pos[0] *= d.wideStance; }
      if (d.narrow) { for (const pt of bp.parts) if (Array.isArray(pt.pos) && /leg|arm/i.test(pt.id)) pt.pos[0] *= d.narrow; }
      if (d.compactBody) mulParam(/body|torso/i, 'd', d.compactBody, 0.05, 6);
      if (d.squatBody) { mulParam(/body/i, 'h', d.squatBody, 0.05, 6); mulParam(/body/i, 'w', 1.15, 0.05, 6); }
      if (d.smallStature) bp.globalScale = clampV((bp.globalScale || 1) * d.smallStature, 0.15, 8);
      if (d.lowSlung) { for (const pt of bp.parts) if (Array.isArray(pt.pos) && /leg/i.test(pt.id)) pt.p && pt.p.h !== undefined ? pt.p.h *= 0.7 : 0; }
      if (d.eyeScale) { for (const pt of bp.parts) if (/eye/i.test(pt.id) && pt.p && pt.p.r !== undefined) pt.p.r = clampV(pt.p.r * d.eyeScale, 0.01, 0.5); applied.push(`ocular scale ×${d.eyeScale}`); }
      if (d.glowEyes) for (const pt of bp.parts) if (/eye/i.test(pt.id)) pt.emissive = 1.4;
      if (d.translucent) bp.translucent = 1;

      /* -- surface markings -- */
      if (d.stripes) bp.stripes = 1;
      if (d.spots) bp.spots = 1;
      if (d.scales) bp.scales = 1;
      if (d.rustPatches) bp.rust = d.rustPatches;
      if (d.whiteTipTail) bp.whiteTip = 1;
      if (d.tuxedoMark || d.bellyWhite) bp.twoToneBelly = 1;
      if (d.stripePattern) bp.stripes = 2;

      /* -- limbs terminal features -- */
      if (d.hoofFeet || d.hooves) { for (const pt of bp.parts) if (/foot|paw/i.test(pt.id)) pt.hoof = 1; applied.push('hooves'); }
      if (d.talons || d.clawTips || d.pincerClaws || d.sickleClaw) {
        bp.parts.push({ id: 'clawSet', kind: 'cone', p: { r: 0.035, h: 0.12 }, pos: [0.28, 0.1, (bp.meta.frontZ || 0.4) * 0.6], rot: [Math.PI / 2, 0, 0], role: 'accent', triple: { axis: 'x', step: 0.09 }, parent: pickJoint(bp, ['legL', 'foot', 'legFL', 'root']), fidelity: 1 });
        applied.push('claw/talon tips');
      }
      if (d.teethRow || d.jawTeeth || d.coneTeeth || d.bigJaws) {
        bp.parts.push({ id: 'teethRow', kind: 'cone', p: { r: 0.02, h: 0.07 }, pos: [0, (bp.meta.headY || 1.1) - 0.12, (bp.meta.headZ || 0.5) + (bp.meta.headR || 0.25) + 0.1], role: 'light', ridgeAlong: 'x', ridgeCount: 7, ridgeSpan: 0.3, upsideDown: 1, parent: pickJoint(bp, ['head', 'jaw', 'headJ']), fidelity: 1 });
        applied.push('dentition row');
      }
      if (d.tusks || d.ivoryTusks) {
        bp.parts.push({ id: 'tuskL', kind: 'cone', p: { r: 0.035, h: 0.45 }, pos: [0.1, (bp.meta.headY || 1.1) - 0.15, (bp.meta.headZ || 0.5) + 0.2], rot: [Math.PI / 2.6, 0, 0.15], role: 'light', mirror: true, parent: pickJoint(bp, ['head', 'headJ']), fidelity: 1 });
        applied.push('tusks');
      }
      if (d.webbed) bp.webbed = 1;
      if (d.ossicone) bp.parts.push({ id: 'ossiconeL', kind: 'cylinder', p: { r: 0.03, h: 0.18 }, pos: [0.1, (bp.meta.headY || 1.2) + 0.14, bp.meta.headZ || 0.4], role: 'accent', mirror: true, parent: pickJoint(bp, ['head', 'headJ']), fidelity: 1 });

      /* -- vehicle / machine specifics -- */
      if (d.rotorCount || d.mainRotor || d.quadRotorArms) {
        const n = d.quadRotorArms ? 4 : d.mainRotor ? 1 : d.rotorCount;
        const y = (bp.meta.topY || 1) + 0.15;
        if (d.quadRotorArms) {
          for (let i = 0; i < n; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2;
            bp.parts.push({ id: 'rotorArm' + i, kind: 'cylinder', p: { r: 0.03, h: 0.6 }, pos: [Math.cos(a) * 0.35, y, Math.sin(a) * 0.35], rot: [0, 0, Math.PI / 2], role: 'dark', parent: 'root', fidelity: 1 });
            bp.parts.push({ id: 'rotor' + i, kind: 'torus', p: { R: 0.28, r: 0.015 }, pos: [Math.cos(a) * 0.62, y + 0.05, Math.sin(a) * 0.62], role: 'glass', spin: 1, parent: 'root', fidelity: 1 });
          }
        } else if (d.mainRotor) {
          bp.parts.push({ id: 'mainRotor', kind: 'box', p: { w: 1.6, h: 0.03, d: 0.12 }, pos: [0, y, 0], role: 'metal', rotorSpin: 1, parent: 'root', fidelity: 1 });
          bp.parts.push({ id: 'tailRotor', kind: 'box', p: { w: 0.4, h: 0.03, d: 0.08 }, pos: [(bp.meta.halfW || 0.5) + 0.3, y - 0.1, -(bp.meta.backZ || 0.8)], rot: [0, 0, 0], role: 'metal', rotorSpin: 1, parent: 'root', fidelity: 1 });
        }
        if (d.landingSkids || d.skidGear) {
          bp.parts.push({ id: 'skidL', kind: 'cylinder', p: { r: 0.03, h: 1.0 }, pos: [0.35, 0.15, 0], rot: [Math.PI / 2, 0, 0], role: 'dark', mirror: true, parent: 'root', fidelity: 1 });
        }
        applied.push('rotor assembly');
      }
      if (d.propeller) bp.parts.push({ id: 'propeller', kind: 'box', p: { w: 0.06, h: 0.5, d: 0.02 }, pos: [0, bp.meta.topY ? bp.meta.topY * 0.7 : 0.8, (bp.meta.frontZ || 0.8) + 0.3], role: 'metal', propSpin: 1, parent: pickJoint(bp, ['nose', 'engine', 'root']), fidelity: 1 });
      if (d.twinTails) {
        bp.parts.push({ id: 'finV1', kind: 'box', p: { w: 0.04, h: 0.3, d: 0.25 }, pos: [0.3, (bp.meta.topY || 0.8) + 0.1, -(bp.meta.backZ || 0.9)], role: 'secondary', mirror: true, parent: 'root', fidelity: 1 });
        applied.push('twin vertical stabilizers');
      }
      if (d.sweptWings) for (const wp of bp.parts) if (/wing/i.test(wp.id)) wp.swept = 0.6;
      if (d.doubleWings) {
        const ups = bp.parts.filter(p => /wing/i.test(p.id));
        for (const u of ups) { const l = clone(u); l.id = u.id + 'Low'; l.pos = clone(u.pos); l.pos[1] -= 0.22; bp.parts.push(l); }
        applied.push('biplane wing stack');
      }
      if (d.enginePodsUnder) bp.parts.push({ id: 'enginePodL', kind: 'cylinder', p: { r: 0.1, h: 0.4 }, pos: [0.5, (bp.meta.topY || 0.8) * 0.55, 0.1], rot: [Math.PI / 2, 0, 0], role: 'metal', mirror: true, parent: 'root', fidelity: 1 });
      if (d.windowRows) bp.windowRows = 1;
      if (d.afterburnerGlow) for (const pt of bp.parts) if (/jet|flame|exhaust/i.test(pt.id)) pt.emissive = 1.5;
      if (d.rearSpoiler) bp.parts.push({ id: 'spoiler', kind: 'box', p: { w: (bp.meta.halfW || 0.6) * 1.8, h: 0.03, d: 0.18 }, pos: [0, (bp.meta.topY || 0.6) + 0.12, -(bp.meta.backZ || 0.7) + 0.05], role: 'dark', parent: 'root', fidelity: 1 });
      if (d.racingStripes) bp.racingStripes = 1;
      if (d.exhaustStacks) bp.parts.push({ id: 'stackL', kind: 'cylinder', p: { r: 0.04, h: 0.5 }, pos: [0.3, (bp.meta.topY || 0.8), -(bp.meta.backZ || 0.6) * 0.4], role: 'metal', mirror: true, parent: 'root', fidelity: 1 });
      if (d.extraRearAxles || d.doubleRearAxle) { bp.extraAxles = 1; }
      if (d.inlineWheels) bp.inlineWheels = 1;
      if (d.handlebars) bp.handlebars = 1;
      if (d.roadWheelCount) bp.roadWheels = d.roadWheelCount;
      if (d.longBarrel) mulParam(/barrel/i, 'h', d.longBarrel, 0.1, 6);
      if (d.smokestack) bp.parts.push({ id: 'smokestack', kind: 'cylinder', p: { r: 0.1, h: 0.5 }, pos: [0, (bp.meta.topY || 0.9) + 0.1, (bp.meta.frontZ || 0.8) * 0.3], role: 'dark', parent: 'root', fidelity: 1 });
      if (d.mastSails) {
        bp.parts.push({ id: 'mast', kind: 'cylinder', p: { r: 0.04, h: 1.4 }, pos: [0, (bp.meta.topY || 0.6) + 0.6, 0], role: 'limb', parent: 'root', fidelity: 1 });
        bp.parts.push({ id: 'sailA', kind: 'box', p: { w: 0.7, h: 0.8, d: 0.03 }, pos: [0, (bp.meta.topY || 0.6) + 0.7, 0.15], role: 'light', parent: 'root', fidelity: 1 });
        applied.push('mast + sail');
      }
      if (d.gridFins) bp.parts.push({ id: 'gridFin', kind: 'box', p: { w: 0.2, h: 0.2, d: 0.03 }, pos: [0.2, (bp.meta.topY || 1.5) * 0.8, 0.1], role: 'dark', mirror: true, gridFin: 1, parent: 'root', fidelity: 1 });
      if (d.tallVertical) { mulParam(/hull|body|stage/i, 'h', d.tallVertical, 0.1, 12); applied.push(`stretched vertically ×${d.tallVertical}`); }
      if (d.lowProfile) { mulParam(/body|chassis|hull/i, 'h', d.lowProfile, 0.05, 6); bp.globalScale = clampV((bp.globalScale || 1) * (1 + (1 - d.lowProfile) * 0.3), 0.15, 8); }
      if (d.wideRear) mulParam(/rear|body/i, 'w', d.wideRear, 0.05, 8);

      /* -- building specifics -- */
      if (d.pitchedRoof) { for (const pt of bp.parts) if (/roof/i.test(pt.id)) pt.pitched = 1; }
      if (d.chimney) bp.parts.push({ id: 'chimney', kind: 'box', p: { w: 0.12, h: 0.4, d: 0.12 }, pos: [0.3, (bp.meta.topY || 1.4) + 0.1, -0.1], role: 'masonry', parent: 'root', fidelity: 1 });
      if (d.crenellations) bp.crenellationCount = 16;
      if (d.moatRing) bp.moat = 1;
      if (d.drawbridge) bp.drawbridge = 1;
      if (d.tieredRoofs) { bp.tiers = d.tieredRoofs; applied.push(`${d.tieredRoofs}-tier roof stack`); }
      if (d.spireAntenna) bp.parts.push({ id: 'spire', kind: 'cone', p: { r: 0.06, h: 0.8 }, pos: [0, (bp.meta.topY || 2) + 0.4, 0], role: 'metal', parent: 'root', fidelity: 1 });
      if (d.setbackSteps) bp.setbacks = 2;
      if (d.deckSpan) { mulParam(/deck|bridge/i, 'd', d.deckSpan, 0.1, 12); applied.push(`deck span ×${d.deckSpan}`); }
      if (d.suspensionCables) bp.cables = 1;
      if (d.steppedPyramid) bp.pyramidSteps = 4;
      if (d.rotatingBlades) {
        for (let i = 0; i < d.rotatingBlades; i++) {
          const a = i * Math.PI * 2 / d.rotatingBlades;
          bp.parts.push({ id: 'blade' + i, kind: 'box', p: { w: 0.12, h: 1.1, d: 0.03 }, pos: [Math.cos(a) * 0.55, (bp.meta.topY || 1.5) + Math.sin(a) * 0.55, 0.2], rot: [0, 0, a + Math.PI / 2], role: 'light', windmillSpin: 1, parent: 'root', fidelity: 1 });
        }
        bp.windmillRotor = 1; applied.push('windmill rotor blades');
      }
      if (d.spokeWheel) {
        bp.parts.push({ id: 'ferrisDisc', kind: 'torus', p: { R: 1.1, r: 0.05 }, pos: [0, 1.4, 0], role: 'metal', ferrisSpin: 1, parent: 'root', fidelity: 1 });
        bp.ferrisSpokes = d.gondolaSeats || 12;
        applied.push(`observation wheel · ${bp.ferrisSpokes} gondolas`);
      }

      /* -- props -- */
      if (d.soundHole) bp.parts.push({ id: 'soundHole', kind: 'cylinder', p: { r: 0.1, h: 0.02 }, pos: [0, (bp.meta.topY || 0.6) * 0.5, (bp.meta.frontZ || 0.2) + 0.02], rot: [Math.PI / 2, 0, 0], role: 'dark', parent: 'root', fidelity: 1 });
      if (d.tuningPegs) bp.tuningPegs = d.tuningPegs;
      if (d.hourMarkers) bp.hourMarkers = d.hourMarkers;
      if (d.pointsCount) bp.crownPoints = d.pointsCount;
      if (d.petalRing) {
        for (let i = 0; i < d.petalRing; i++) {
          const a = i * Math.PI * 2 / d.petalRing;
          bp.parts.push({ id: 'petal' + i, kind: 'sphere', p: { r: 0.1 }, pos: [Math.cos(a) * 0.18, (bp.meta.topY || 1) + 0.02, Math.sin(a) * 0.18], scale: [1, 0.25, 0.6], role: 'primary', petal: 1, parent: pickJoint(bp, ['canopy', 'top', 'root']), fidelity: 1 });
        }
        bp.parts.push({ id: 'flowerCore', kind: 'cylinder', p: { r: 0.08, h: 0.06 }, pos: [0, (bp.meta.topY || 1) + 0.05, 0], role: 'accent', parent: 'root', fidelity: 1 });
        applied.push(`${d.petalRing}-petal corolla ring`);
      }
      if (d.torusFood) bp.torusFood = 1;
      if (d.spikesBack) { if (!bp.addons.includes('spikes')) this.addAddon(bp, 'spikes'); }
      if (d.armorPlates) { if (!bp.addons.includes('armor')) this.addAddon(bp, 'armor'); }
      if (d.antennaPair) { if (!bp.addons.includes('antenna')) this.addAddon(bp, 'antenna'); }
      if (d.cape || d.capeCollar) {
        bp.parts.push({ id: 'cape', kind: 'box', p: { w: 0.7, h: 0.9, d: 0.03 }, pos: [0, (bp.meta.topY || 1.3) * 0.62, -(bp.meta.backZ || 0.3) - 0.06], rot: [0.12, 0, 0], role: 'accent', cape: 1, parent: pickJoint(bp, ['chest', 'torso', 'spine', 'root']), fidelity: 1 });
        applied.push('flowing cape');
      }
      if (d.haloRing) bp.parts.push({ id: 'halo', kind: 'torus', p: { R: 0.2, r: 0.02 }, pos: [0, (bp.meta.headY || 1.4) + 0.35, 0], role: 'glow', emissive: 1, haloFloat: 1, parent: pickJoint(bp, ['head', 'headJ']), fidelity: 1 });
      if (d.pointyHat) bp.parts.push({ id: 'hatCone', kind: 'cone', p: { r: 0.22, h: 0.4 }, pos: [0, (bp.meta.headY || 1.3) + 0.28, bp.meta.headZ || 0], role: 'accent', parent: pickJoint(bp, ['head', 'headJ']), fidelity: 1 });
      if (d.staff) bp.parts.push({ id: 'staff', kind: 'cylinder', p: { r: 0.025, h: 1.5 }, pos: [0.45, 0.75, 0.1], role: 'limb', parent: pickJoint(bp, ['armR', 'handR', 'shoulder', 'root']), fidelity: 1 });
      if (d.swordArm) bp.parts.push({ id: 'sword', kind: 'box', p: { w: 0.05, h: 0.9, d: 0.02 }, pos: [0.5, 1.0, 0.25], rot: [0.4, 0, 0.1], role: 'metal', parent: pickJoint(bp, ['armR', 'handR', 'shoulder', 'root']), fidelity: 1 });
      if (d.shieldBack) bp.parts.push({ id: 'shield', kind: 'box', p: { w: 0.4, h: 0.5, d: 0.03 }, pos: [-0.45, 0.9, -0.1], role: 'accent', parent: pickJoint(bp, ['armL', 'shoulder', 'root']), fidelity: 1 });

      /* -- materials & palette -- */
      const mt = bp.materialTweak || (bp.materialTweak = { metalness: 0, roughness: 0, emissive: 0 });
      const m = spec.materials || {};
      if (m.metalnessBias) mt.metalness = clampV(mt.metalness + m.metalnessBias, -0.5, 0.9);
      if (m.roughnessBias) mt.roughness = clampV(mt.roughness + m.roughnessBias, -0.5, 0.8);
      if (m.emissiveBias || m.emissive) mt.emissive = clampV(mt.emissive + (m.emissiveBias || m.emissive), 0, 2);
      bp.palette = Object.assign({}, bp.palette, spec.palette || {});
      delete bp.palette._named; delete bp.palette._namedLocked;

      /* -- dims -- */
      if (spec.dims && spec.dims.requested && spec.dims.requested.length) {
        bp.dimsRequested = spec.dims.requested;
        if (spec.dims.scaleFromDims) bp.globalScale = clampV((bp.globalScale || 1) * spec.dims.scaleFromDims, 0.15, 8);
        applied.push(`honoring requested size (${spec.dims.requested.map(x => x.raw).join(', ')})`);
      }
      if (spec.dims && spec.dims.relScale) bp.globalScale = clampV((bp.globalScale || 1) * spec.dims.relScale, 0.15, 8);
      if (spec.sizeMul) bp.globalScale = clampV((bp.globalScale || 1) * spec.sizeMul, 0.15, 8);

      /* -- fact-bound annotations travel with the blueprint -- */
      if (spec.factNotes && spec.factNotes.length) bp.factNotes = spec.factNotes.slice();

      bp.fidelityApplied = applied;
      bp.meta = computeMeta(bp.parts);
      return applied;
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

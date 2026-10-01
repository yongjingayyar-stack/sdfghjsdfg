/* =========================================================
 * joints.js — Tool #5: ANIMATION-ABLE JOINTS APPLIER
 * Builds a THREE.Bone hierarchy from blueprint joints,
 * re-parents part meshes onto their assigned bones (rigid
 * skin binding = guaranteed artifact-free GLB export), and
 * procedurally generates THREE.AnimationClip keyframe tracks
 * for every derived clip (Idle / Walk / Fly / Swagger / Aim / Roll).
 * ======================================================= */
(function () {
  'use strict';

  window.Joints = {
    /**
     * rig(bp, built) -> {rootBone, boneMap, clips[], animMixerReady}
     * Mutates built.group: removes original meshes, attaches them under bones.
     */
    rig(bp, built) {
      const group = built.group;
      const jointDefs = bp.joints && bp.joints.length ? bp.joints : [['root', 0, 0, 0]];

      // 1. create bones (tuple format: [name,x,y,z] root OR [name,parent,x,y,z])
      const boneMap = {};
      for (const jd of jointDefs) {
        const name = jd[0];
        const bone = new THREE.Bone();
        bone.name = 'bone_' + sanitize(name);
        bone.userData.logical = name;
        boneMap[name] = bone;
      }
      // 2. link hierarchy & set absolute anchor position on each bone first
      const absPos = {};
      for (let i = 0; i < jointDefs.length; i++) {
        const jd = jointDefs[i];
        let name, parentName, x, y, z;
        if (jd.length === 5) { [name, parentName, x, y, z] = jd; }
        else { [name, x, y, z] = jd; parentName = i === 0 ? null : jointDefs[0][0]; }
        absPos[name] = new THREE.Vector3(x, y, z);
        const bone = boneMap[name];
        const pb = parentName && boneMap[parentName] && parentName !== name ? boneMap[parentName] : null;
        if (pb) pb.add(bone);
      }
      // now convert absolute → local relative to parent bone
      for (const name of Object.keys(boneMap)) {
        const bone = boneMap[name];
        const pAbs = absPos[name].clone();
        if (bone.parent && bone.parent.isBone) {
          const pp = absPos[bone.parent.userData.logical];
          if (pp) pAbs.sub(pp);
        }
        bone.position.copy(pAbs);
      }

      const rootName = jointDefs[0][0];
      const rootBone = boneMap[rootName];

      // 3. detach meshes from group & rigid-bind onto their assigned bones,
      //    preserving exact world placement (THREE.Object3D.attach handles the math).
      const meshes = [];
      const kids = group.children.slice();
      group.children.length = 0;
      kids.forEach(c => { if (c.isMesh) meshes.push(c); });

      const rootName2 = rootName;
      for (const m of meshes) {
        const jn = (m.userData.joint && boneMap[m.userData.joint]) ? m.userData.joint : rootName2;
        m.userData.bindBone = jn;   // remember binding for GLB post-processing
        const bone = boneMap[jn];
        bone.attach(m);             // keeps world transform while reparenting
      }
      group.add(rootBone);
      group.updateMatrixWorld(true);

      // 4. animation clips
      const speed = bp.animSpeed === undefined ? 1 : bp.animSpeed;
      const clips = [];
      for (const clipDef of (bp.clips || [{ name: 'Idle', duration: 3 }])) {
        const clip = makeClip(clipDef.name, clipDef.duration, boneMap, rootName, bp);
        if (clip) clips.push(clip);
      }
      return { rootBone, boneMap, clips, speed: Math.max(0, speed) };
    },

    sanitize,
  };

  function sanitize(n) { return String(n).replace(/[^a-zA-Z0-9_]/g, '_'); }

  /* ---------- procedural clip generator ---------- */
  function makeClip(clipName, duration, boneMap, rootName, bp) {
    const tracks = [];
    const fps = 12;
    const times = [];
    for (let t = 0; t <= duration + 0.001; t += 1 / fps) times.push(+t.toFixed(4));
    const N = times.length;

    const rotTrack = (bonePath, fn) => {
      const values = new Float32Array(N * 4);
      const q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < N; i++) {
        const ph = times[i] / duration;
        const [ex, ey, ez] = fn(ph);
        e.set(ex, ey, ez); q.setFromEuler(e);
        values[i * 4] = q.x; values[i * 4 + 1] = q.y; values[i * 4 + 2] = q.z; values[i * 4 + 3] = q.w;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(bonePath + '.quaternion', times, values));
    };
    const posTrack = (bonePath, fn) => {
      const values = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const [x, y, z] = fn(times[i] / duration);
        values[i * 3] = x; values[i * 3 + 1] = y; values[i * 3 + 2] = z;
      }
      tracks.push(new THREE.VectorKeyframeTrack(bonePath + '.position', times, values));
    };

    const has = (n) => !!boneMap[n];
    const path = (n) => 'bone_' + sanitize(n);
    const A = 0.55; // amplitude base
    const TAU = Math.PI * 2;

    if (clipName === 'Walk') {
      const legNames = ['legFL', 'legFR', 'legBL', 'legBR', 'legL', 'legR'].filter(has);
      legNames.forEach((ln, idx) => {
        const phase = idx * (TAU / Math.max(2, legNames.length));
        rotTrack(path(ln), (ph) => [Math.sin(ph * TAU + phase) * 0.6, 0, Math.cos(ph * TAU + phase) * 0.12]);
      });
      if (has('spine')) rotTrack(path('spine'), (ph) => [0, Math.sin(ph * TAU) * 0.06, Math.sin(ph * TAU * 2) * 0.03]);
      if (has('hips')) rotTrack(path('hips'), (ph) => [0, 0, Math.sin(ph * TAU) * 0.05]);
      if (has('tail')) rotTrack(path('tail'), (ph) => [0, Math.sin(ph * TAU) * 0.4, 0]);
      if (has('tailJ')) rotTrack(path('tailJ'), (ph) => [0, Math.sin(ph * TAU) * 0.4, 0]);
      if (has('legA')) rotTrack(path('legA'), (ph) => [Math.sin(ph * TAU) * 0.5, 0, 0]);
      if (has('legB')) rotTrack(path('legB'), (ph) => [-Math.sin(ph * TAU) * 0.5, 0, 0]);
    } else if (clipName === 'Fly') {
      const wings = ['wingL', 'wingR', 'finL', 'finR'].filter(has);
      wings.forEach((w, i) => rotTrack(path(w), (ph) => [0, 0, Math.sin(ph * TAU + (i ? Math.PI : 0)) * 1.0]));
      if (has('bodyJ')) posTrack(path('bodyJ'), (ph) => [0, Math.sin(ph * TAU) * 0.08, 0]);
      if (has('body')) posTrack(path('body'), (ph) => [0, Math.sin(ph * TAU) * 0.08, 0]);
      if (has('chest')) posTrack(path('chest'), (ph) => [0, Math.sin(ph * TAU) * 0.07, 0]);
    } else if (clipName === 'Swagger') {
      if (has('tail')) rotTrack(path('tail'), (ph) => [Math.sin(ph * TAU) * 0.3, Math.sin(ph * TAU * 0.5) * 0.5, 0]);
      if (has('tailJ')) rotTrack(path('tailJ'), (ph) => [Math.sin(ph * TAU) * 0.3, Math.sin(ph * TAU * 0.5) * 0.5, 0]);
      if (has('head')) rotTrack(path('head'), (ph) => [0, Math.sin(ph * TAU * 0.5) * 0.25, 0]);
      if (has('headJ')) rotTrack(path('headJ'), (ph) => [0, Math.sin(ph * TAU * 0.5) * 0.25, 0]);
    } else if (clipName === 'Aim') {
      if (has('turretJ')) rotTrack(path('turretJ'), (ph) => [0, Math.sin(ph * TAU) * 0.9, 0]);
      if (has('barrelJ')) rotTrack(path('barrelJ'), (ph) => [Math.sin(ph * TAU * 0.5) * 0.25, 0, 0]);
    } else if (clipName === 'Roll') {
      ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].filter(has).forEach((w) => {
        rotTrack(path(w), (ph) => [-ph * TAU * 3, 0, 0]);
      });
    } else { // Idle
      const bob = has('root') ? 'root' : Object.keys(boneMap)[0];
      posTrack(path(bob), (ph) => [0, Math.sin(ph * TAU) * 0.035, 0]);
      if (has('spine')) rotTrack(path('spine'), (ph) => [Math.sin(ph * TAU) * 0.03, 0, 0]);
      if (has('chest')) rotTrack(path('chest'), (ph) => [Math.sin(ph * TAU) * 0.04, 0, 0]);
      if (has('torso')) rotTrack(path('torso'), (ph) => [Math.sin(ph * TAU) * 0.04, 0, 0]);
      if (has('head')) rotTrack(path('head'), (ph) => [Math.sin(ph * TAU * 0.5) * 0.08, Math.sin(ph * TAU * 0.3) * 0.12, 0]);
      if (has('headJ')) rotTrack(path('headJ'), (ph) => [Math.sin(ph * TAU * 0.5) * 0.08, Math.sin(ph * TAU * 0.3) * 0.12, 0]);
      if (has('neck')) rotTrack(path('neck'), (ph) => [Math.sin(ph * TAU * 0.7) * 0.05, 0, 0]);
      if (has('armL')) rotTrack(path('armL'), (ph) => [Math.sin(ph * TAU) * 0.08, 0, 0]);
      if (has('armR')) rotTrack(path('armR'), (ph) => [-Math.sin(ph * TAU) * 0.08, 0, 0]);
      if (has('tail')) rotTrack(path('tail'), (ph) => [0, Math.sin(ph * TAU * 0.8) * 0.25, 0]);
    }

    if (!tracks.length) return null;
    return new THREE.AnimationClip(clipName, duration, tracks);
  }
})();

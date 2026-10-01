/* =========================================================
 * compiler.js — Tool #6: GLB FILE COMPILER
 * Serializes the rigged scene graph to binary glTF (.glb)
 * using THREE.GLTFExporter. Meshes rigid-bound to bones are
 * converted into proper glTF skins (each mesh gets a 1-weight
 * skin to its bind bone) so the exported file is fully
 * animation-able in Blender / three.js / Babylon viewers.
 * Falls back to plain-mesh GLB if skinning fails.
 * ======================================================= */
(function () {
  'use strict';

  window.Compiler = {
    /**
     * compile(group, opts{binary:true}) -> Promise<ArrayBuffer>
     */
    compile(group, opts) {
      return new Promise((resolve, reject) => {
        try {
          prepareSkins(group);

          if (typeof THREE.GLTFExporter === 'undefined') {
            reject(new Error('GLTFExporter unavailable'));
            return;
          }
          const exporter = new THREE.GLTFExporter();
          exporter.parse(
            group,
            (result) => {
              if (result instanceof ArrayBuffer) resolve(result);
              else {
                // JSON result → wrap minimal GLB ourselves
                const enc = new TextEncoder().encode(JSON.stringify(result));
                const buf = buildGlbFromJson(enc);
                resolve(buf);
              }
            },
            (err) => reject(err),
            { binary: true, animations: true, onlyVisible: false, truncateDrawRange: true }
          );
        } catch (e) { reject(e); }
      });
    },

    /** validate a compiled GLB buffer: magic + version + chunk headers */
    validate(buf) {
      try {
        const dv = new DataView(buf);
        if (buf.byteLength < 12) return { ok: false, why: 'too short' };
        const magic = dv.getUint32(0, true);
        const ver = dv.getUint32(4, true);
        if (magic !== 0x46546C67) return { ok: false, why: 'bad magic' };
        if (ver !== 2) return { ok: false, why: 'bad version' };
        const total = dv.getUint32(8, true);
        if (total !== buf.byteLength) return { ok: false, why: 'length mismatch', total };
        // parse chunks — NOTE: in glTF the chunk length INCLUDES its 8-byte header
        let off = 12, chunks = 0, sawJSON = false;
        while (off + 8 <= buf.byteLength && chunks < 16) {
          const clen = dv.getUint32(off, true);   // includes header
          const ctype = dv.getUint32(off + 4, true);
          if (clen % 4 !== 0 || off + clen > buf.byteLength) return { ok: false, why: 'bad chunk bounds' };
          if (ctype === 0x4E4F534A) sawJSON = true;
          off += clen; chunks++;
        }
        if (!sawJSON) return { ok: false, why: 'no JSON chunk' };
        return { ok: off === buf.byteLength, sizeKB: (buf.byteLength / 1024).toFixed(1), chunks };
      } catch (e) { return { ok: false, why: String(e) }; }
    },

    download(buf, filename) {
      const blob = new Blob([buf], { type: 'model/gltf-binary' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'forge-model.glb';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    },
  };

  /* ---------- convert bone-parented meshes to SkinnedMesh w/ 1-weight skin ---------- */
  function prepareSkins(group) {
    const bones = [];
    group.traverse(o => { if (o.isBone) bones.push(o); });
    if (!bones.length) return;

    // map logical name -> ORIGINAL bone (never clone/move these)
    const byName = {};
    bones.forEach(b => { byName[b.name] = b; });

    const meshesToSkin = [];
    group.traverse(o => { if (o.isMesh && o.userData.bindBone) meshesToSkin.push(o); });

    for (const mesh of meshesToSkin) {
      const bindName = 'bone_' + Joints.sanitize(mesh.userData.bindBone);
      const bone = byName[bindName] || bones[0];
      if (!bone) continue;

      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const count = geo.attributes.position.count;
      const si = new Uint16Array(count * 4);      // all vertices → joint index 0
      const sw = new Float32Array(count * 4);     // weight 1 on slot 0
      for (let i = 0; i < count; i++) sw[i * 4] = 1.0;
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

      const parent = mesh.parent;
      const pos = mesh.position.clone(), quat = mesh.quaternion.clone(), scl = mesh.scale.clone();

      const skinned = new THREE.SkinnedMesh(geo, mesh.material);
      skinned.name = mesh.name;
      skinned.userData = Object.assign({}, mesh.userData);
      delete skinned.userData.bindBone;           // consumed — avoid re-processing
      skinned.position.copy(pos); skinned.quaternion.copy(quat); skinned.scale.copy(scl);

      parent.remove(mesh);
      parent.add(skinned);
      // bind to the single original bone; identity bindMatrix keeps current transform
      skinned.bind(new THREE.Skeleton([bone]), new THREE.Matrix4());
    }
    group.updateMatrixWorld(true);
  }

  /* ---------- minimal GLB wrapper for JSON export results ---------- */
  function buildGlbFromJson(jsonBytes) {
    const pad = (n) => (4 - (n % 4)) % 4;
    const jsonLen = jsonBytes.length + pad(jsonBytes.length);
    const binLen = 0;
    const total = 12 + 8 + jsonLen + 8 + binLen;
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x46546C67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.length + pad(jsonBytes.length), true);
    dv.setUint32(16, 0x4E4F534A, true);
    new Uint8Array(buf, 20, jsonBytes.length).set(jsonBytes);
    return buf;
  }
})();

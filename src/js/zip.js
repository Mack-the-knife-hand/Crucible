// =============================================================================
// zip.js — streaming ZIP writer (no libraries), used by "Package & back up"
// -----------------------------------------------------------------------------
// Works in the browser edition and in the desktop app's Node back end.
// * Files are read and written as streams, so a drive full of music doesn't
//   have to fit in memory.
// * Text-like files (.md, .json, .html, .txt) are compressed; media files
//   (.mp3, .png, .jpg…) are already compressed and are stored as-is (fast).
// * ZIP64 is used automatically when a file, the archive or the file count
//   passes the classic ZIP limits (4 GB / 65,535 files).
// Each entry: { name, size, mtime: Date, stream(): ReadableStream<Uint8Array> }
// Sink: { write(Uint8Array): Promise, close(): Promise }
// =============================================================================

(function (root) {
  const LIMIT = { value: 0xFFFFFFFF }; // tests lower this to exercise ZIP64
  const COMPRESS = /\.(md|markdown|txt|json|html?|xhtml|css|js|csv|xml|svg|opf|ncx|rels)$/i;

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(crc, buf) {
    let c = ~crc >>> 0;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return ~c >>> 0;
  }

  // Little-endian byte writer.
  class Bytes {
    constructor(n) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); this.o = 0; }
    u16(x) { this.v.setUint16(this.o, x, true); this.o += 2; return this; }
    u32(x) { this.v.setUint32(this.o, x >>> 0, true); this.o += 4; return this; }
    u64(x) { this.v.setUint32(this.o, x % 0x100000000, true); this.v.setUint32(this.o + 4, Math.floor(x / 0x100000000), true); this.o += 8; return this; }
    raw(a) { this.b.set(a, this.o); this.o += a.length; return this; }
  }

  function dosTime(d) {
    const y = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // Deflate a stream if the runtime supports it (all current Chromium/Node).
  function maybeDeflate(stream, name) {
    if (!COMPRESS.test(name) || typeof CompressionStream === 'undefined') return { stream, method: 0 };
    return { stream: stream.pipeThrough(new CompressionStream('deflate-raw')), method: 8 };
  }

  async function writeZip(entries, sink, { onProgress = () => {}, signal } = {}) {
    const enc = new TextEncoder();
    const central = [];
    let offset = 0;
    let doneBytes = 0;
    const total = entries.reduce((a, e) => a + (e.size || 0), 0);
    const out = async (u8) => { await sink.write(u8); offset += u8.length; };

    for (const e of entries) {
      if (signal?.aborted) throw new Error('Cancelled');
      const name = enc.encode(e.name.replace(/\\/g, '/'));
      const { time, date } = dosTime(e.mtime || new Date());
      if (e.data) {
        // In-memory entry (generated documents): sizes and CRC go straight in
        // the header, no data descriptor. Required for EPUB's "mimetype".
        const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
        const crc = crc32(0, data);
        let body = data, method = 0;
        if (!e.store && COMPRESS.test(e.name) && typeof CompressionStream !== 'undefined' && data.length > 64) {
          const chunks = [];
          const r = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw')).getReader();
          for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
          body = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
          let o = 0; for (const c of chunks) { body.set(c, o); o += c.length; }
          method = 8;
        }
        const start = offset;
        const lh = new Bytes(30 + name.length);
        lh.u32(0x04034b50).u16(20).u16(0x0800).u16(method).u16(time).u16(date)
          .u32(crc).u32(body.length).u32(data.length).u16(name.length).u16(0).raw(name);
        await out(lh.b);
        await out(body);
        doneBytes += data.length;
        central.push({ name, method, time, date, crc, csize: body.length, usize: data.length, start, z64: false, flags: 0x0800 });
        continue;
      }
      const big = (e.size || 0) >= LIMIT.value;           // ZIP64 sizes for this entry
      const start = offset;
      const src = e.stream();
      const { stream, method } = maybeDeflate(src, e.name);

      // Local header. Sizes/CRC follow in a data descriptor (flag bit 3), so
      // each file is read only once. Bit 11 = UTF-8 file names.
      const lh = new Bytes(30 + name.length + (big ? 20 : 0));
      lh.u32(0x04034b50).u16(big ? 45 : 20).u16(0x0808).u16(method).u16(time).u16(date)
        .u32(0).u32(big ? 0xFFFFFFFF : 0).u32(big ? 0xFFFFFFFF : 0).u16(name.length).u16(big ? 20 : 0).raw(name);
      if (big) lh.u16(0x0001).u16(16).u64(0).u64(0);
      await out(lh.b);

      // Data: CRC is computed over the ORIGINAL bytes, so tee the source.
      let crc = 0, usize = 0, csize = 0;
      // When compressing, the CRC must be of the ORIGINAL bytes, so the source
      // is opened a second time for it (only small text files are compressed).
      if (method === 8) {
        const r1 = e.stream().getReader();
        for (;;) { const { done, value } = await r1.read(); if (done) break; crc = crc32(crc, value); usize += value.length; }
        const r2 = stream.getReader();
        for (;;) { const { done, value } = await r2.read(); if (done) break; csize += value.length; await out(value); }
      } else {
        const r = stream.getReader();
        for (;;) {
          if (signal?.aborted) { r.cancel().catch(() => {}); throw new Error('Cancelled'); }
          const { done, value } = await r.read();
          if (done) break;
          crc = crc32(crc, value);
          usize += value.length;
          await out(value);
          doneBytes += value.length;
          onProgress(doneBytes, total, e.name);
        }
        csize = usize;
      }
      if (method === 8) { doneBytes += usize; onProgress(doneBytes, total, e.name); }

      const z64 = big || usize >= LIMIT.value || csize >= LIMIT.value;
      const dd = new Bytes(z64 ? 24 : 16);
      dd.u32(0x08074b50).u32(crc);
      if (z64) dd.u64(csize).u64(usize); else dd.u32(csize).u32(usize);
      await out(dd.b);
      central.push({ name, method, time, date, crc, csize, usize, start, z64 });
    }

    // Central directory.
    const cdStart = offset;
    for (const c of central) {
      const needOff = c.start >= LIMIT.value;
      const sizes64 = c.z64;
      const extraLen = (sizes64 || needOff) ? 4 + (sizes64 ? 16 : 0) + (needOff ? 8 : 0) : 0;
      const h = new Bytes(46 + c.name.length + extraLen);
      h.u32(0x02014b50).u16(45).u16(extraLen ? 45 : 20).u16(c.flags ?? 0x0808).u16(c.method).u16(c.time).u16(c.date)
        .u32(c.crc).u32(sizes64 ? 0xFFFFFFFF : c.csize).u32(sizes64 ? 0xFFFFFFFF : c.usize)
        .u16(c.name.length).u16(extraLen).u16(0).u16(0).u16(0).u32(0)
        .u32(needOff ? 0xFFFFFFFF : c.start).raw(c.name);
      if (extraLen) {
        h.u16(0x0001).u16(extraLen - 4);
        if (sizes64) h.u64(c.usize).u64(c.csize);
        if (needOff) h.u64(c.start);
      }
      await out(h.b);
    }
    const cdSize = offset - cdStart;
    const n = central.length;
    if (n >= 0xFFFF || cdStart >= LIMIT.value || cdSize >= LIMIT.value || offset >= LIMIT.value) {
      const z64Start = offset;
      const r = new Bytes(56 + 20);
      r.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(n).u64(n).u64(cdSize).u64(cdStart);
      r.u32(0x07064b50).u32(0).u64(z64Start).u32(1);
      await out(r.b);
      const e = new Bytes(22);
      e.u32(0x06054b50).u16(0).u16(0).u16(0xFFFF).u16(0xFFFF).u32(0xFFFFFFFF).u32(0xFFFFFFFF).u16(0);
      await out(e.b);
    } else {
      const e = new Bytes(22);
      e.u32(0x06054b50).u16(0).u16(0).u16(n).u16(n).u32(cdSize).u32(cdStart).u16(0);
      await out(e.b);
    }
    await sink.close();
    return { files: n, bytes: offset };
  }

  // ------------------------------------------------------------ reading --
  // src: { size, read(offset, length) → Promise<Uint8Array> }
  // Returns { entries: [{ name, size, csize, method, crc, offset, dir }], open(entry) → ReadableStream }
  async function readZip(src) {
    const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const u16 = (b, o) => b[o] | (b[o + 1] << 8);
    const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
    const tailLen = Math.min(src.size, 22 + 65535 + 20);
    const tail = await src.read(src.size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This file isn\'t a ZIP archive (or it is damaged).');
    let count = u16(tail, e + 10);
    let cdSize = u32(tail, e + 12);
    let cdOff = u32(tail, e + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
      const loc = e - 20;
      if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('Damaged ZIP64 archive.');
      const z64Off = u64(tail, loc + 8);
      const z = await src.read(z64Off, 56);
      if (u32(z, 0) !== 0x06064b50) throw new Error('Damaged ZIP64 archive.');
      count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
    }
    // Sanity limits, so a doctored archive can't make Crucible read or write
    // absurd amounts (a "zip bomb").
    if (count > 500000 || cdSize > src.size || cdOff + cdSize > src.size) throw new Error('This ZIP archive is damaged or not a real backup.');
    const cd = await src.read(cdOff, cdSize);
    const dec = new TextDecoder();
    const entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (u32(cd, p) !== 0x02014b50) throw new Error('Damaged ZIP directory.');
      const method = u16(cd, p + 10);
      const crc = u32(cd, p + 16);
      let csize = u32(cd, p + 20), size = u32(cd, p + 24);
      const nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
      let offset = u32(cd, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
      for (let x = p + 46 + nl; x < p + 46 + nl + xl;) {
        const id = u16(cd, x), len = u16(cd, x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size === 0xFFFFFFFF) { size = u64(cd, q); q += 8; }
          if (csize === 0xFFFFFFFF) { csize = u64(cd, q); q += 8; }
          if (offset === 0xFFFFFFFF) { offset = u64(cd, q); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, size, csize, method, crc, offset, dir: name.endsWith('/') });
      p += 46 + nl + xl + cl;
    }
    // Every entry must have its own bytes: overlapping entries are a classic
    // trick for making a tiny archive unpack to an enormous size.
    const byOff = [...entries].sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < byOff.length; i++) {
      const en = byOff[i];
      const limit = i + 1 < byOff.length ? byOff[i + 1].offset : cdOff;
      if (en.offset + 30 + en.csize > limit) throw new Error('This ZIP archive is damaged (its entries overlap).');
    }
    // Real backups are music and pictures (stored as-is) plus text: nothing
    // like a 100-to-1 overall ratio.
    const declared = entries.reduce((a, en) => a + en.size, 0);
    if (declared > src.size * 100 + 256 * 1024 * 1024) throw new Error('This ZIP archive claims to unpack to far more data than a backup could. It was not restored.');
    const open = (en) => {
      let pos = null, end = 0;
      const CHUNK = 1 << 20;
      let raw = new ReadableStream({
        async pull(ctrl) {
          if (pos === null) {
            const lh = await src.read(en.offset, 30);
            if (u32(lh, 0) !== 0x04034b50) { ctrl.error(new Error(`Damaged entry: ${en.name}`)); return; }
            pos = en.offset + 30 + u16(lh, 26) + u16(lh, 28);
            end = pos + en.csize;
          }
          if (pos >= end) { ctrl.close(); return; }
          const n = Math.min(CHUNK, end - pos);
          const b = await src.read(pos, n);
          pos += n;
          ctrl.enqueue(b);
        },
      });
      if (en.method === 8) raw = raw.pipeThrough(new DecompressionStream('deflate-raw'));
      else if (en.method !== 0) throw new Error(`Unsupported compression in ${en.name}`);
      // Verify the CRC so a damaged backup is reported, not silently restored.
      // Also stop the moment an entry produces more than it declared.
      let crc = 0, got = 0;
      return raw.pipeThrough(new TransformStream({
        transform(chunk, ctrl) {
          got += chunk.length;
          if (got > en.size) { ctrl.error(new Error(`${en.name} unpacks to more data than the archive says: the backup is damaged or doctored.`)); return; }
          crc = crc32(crc, chunk); ctrl.enqueue(chunk);
        },
        flush(ctrl) { if (got !== en.size || crc !== en.crc) ctrl.error(new Error(`Checksum mismatch in ${en.name}: the backup is damaged.`)); },
      }));
    };
    return { entries, open };
  }

  // Turn an archive path into safe folder/file names (no "..", no drive
  // letters, no characters Windows forbids). Returns [] for unsafe paths.
  function safeParts(name) {
    const parts = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
    if (parts.some((p) => p === '..')) return [];
    return parts.map((p) => {
      const q = p.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '_';
      // Windows device names (CON, NUL, COM1…) can't be ordinary files.
      return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(q) ? `_${q}` : q;
    });
  }

  const api = { writeZip, readZip, safeParts, crc32, LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof window !== 'undefined' ? window : globalThis);

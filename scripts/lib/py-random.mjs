// Python's random.Random(int).sample(population, k), reproduced exactly (MT19937,
// init_by_array seeding, _randbelow via getrandbits, the set-based sample branch).
export function pyRandom(seed) {
  const mt = new Uint32Array(624); let mti = 625;
  const initGenrand = (s) => { mt[0] = s >>> 0; for (mti = 1; mti < 624; mti++) { const p = mt[mti - 1] ^ (mt[mti - 1] >>> 30); mt[mti] = (Math.imul(1812433253, p) + mti) >>> 0; } };
  const key = []; let a = BigInt(Math.abs(seed)); if (a === 0n) key.push(0); while (a > 0n) { key.push(Number(a & 0xffffffffn)); a >>= 32n; }
  initGenrand(19650218);
  let i = 1, j = 0;
  for (let k = Math.max(624, key.length); k; k--) {
    const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
    mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0; i++; j++;
    if (i >= 624) { mt[0] = mt[623]; i = 1; } if (j >= key.length) j = 0;
  }
  for (let k = 623; k; k--) {
    const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
    mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0; i++;
    if (i >= 624) { mt[0] = mt[623]; i = 1; }
  }
  mt[0] = 0x80000000; mti = 624;
  const next = () => {
    if (mti >= 624) {
      for (let kk = 0; kk < 624; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % 624] & 0x7fffffff);
        mt[kk] = (mt[(kk + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
      }
      mti = 0;
    }
    let y = mt[mti++];
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return y >>> 0;
  };
  const getrandbits = (k) => next() >>> (32 - k); // k <= 32
  const randbelow = (n) => { const k = n.toString(2).length; let r = getrandbits(k); while (r >= n) r = getrandbits(k); return r; };
  const sample = (pop, k) => {
    const n = pop.length; let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    const out = [];
    if (n <= setsize) { const pool = [...pop]; for (let x = 0; x < k; x++) { const jj = randbelow(n - x); out.push(pool[jj]); pool[jj] = pool[n - x - 1]; } }
    else { const sel = new Set(); for (let x = 0; x < k; x++) { let jj = randbelow(n); while (sel.has(jj)) jj = randbelow(n); sel.add(jj); out.push(pop[jj]); } }
    return out;
  };
  return { sample, next };
}

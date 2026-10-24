/**
 * Anonymous panel labels for blind comparison: A, B, …, Z, AA, AB, …
 * @param {number} index - Zero-based position.
 * @returns {string}
 */
export function blindLetter(index) {
  let value = Math.max(0, Math.floor(index));
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

/**
 * Keeps the labels of panels that are still open, so a panel never changes
 * its letter while blind mode is on, and gives new panels the first free one.
 * @param {string[]} panelIds - Open panels in display order.
 * @param {Map<string, string>} [labels] - Labels assigned so far.
 * @returns {Map<string, string>}
 */
export function assignBlindLabels(panelIds, labels = new Map()) {
  const next = new Map([...labels].filter(([id]) => panelIds.includes(id)));
  const used = new Set(next.values());
  let index = 0;
  for (const id of panelIds) {
    if (next.has(id)) continue;
    while (used.has(blindLetter(index))) index += 1;
    const label = blindLetter(index);
    next.set(id, label);
    used.add(label);
  }
  return next;
}

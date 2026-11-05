/**
 * Display order of panels in blind mode. Panels are only reordered visually
 * (CSS `order`), so their frames never reload and the saved order is kept.
 */

/**
 * Random permutation of `ids` that differs from the input whenever it can.
 * @param {string[]} ids - Current display order.
 * @param {() => number} [random]
 * @returns {string[]}
 */
export function shuffleOrder(ids, random = Math.random) {
  const next = [...ids];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  if (next.length > 1 && next.every((id, index) => id === ids[index])) {
    next.push(next.shift());
  }
  return next;
}

/**
 * Keeps open panels where they are shown and inserts new panels at random
 * positions, so a panel added in blind mode is not given away by its place.
 * @param {string[] | null} order - Display order so far.
 * @param {string[]} panelIds - Open panels.
 * @param {() => number} [random]
 * @returns {string[]}
 */
export function syncDisplayOrder(order, panelIds, random = Math.random) {
  const next = (order || []).filter(id => panelIds.includes(id));
  for (const id of panelIds) {
    if (next.includes(id)) continue;
    next.splice(Math.floor(random() * (next.length + 1)), 0, id);
  }
  return next;
}

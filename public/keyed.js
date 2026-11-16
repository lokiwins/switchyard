/*
 * Draw a list again without rebuilding what didn't change. Each item has a
 * key (which thing it is) and a sig (everything it is drawn from): an element
 * whose key and sig are the same as last time is kept as it is, so a text
 * selection, keyboard focus or open menu in it survives; only new or changed
 * items are built. Elements are moved as little as possible, since moving one
 * also drops a selection or focus inside it.
 */

// What each element was built from. Kept off the DOM (a row's sig is its whole data).
const built = new WeakMap();

/** The positions in `values` of a longest increasing run (not necessarily adjacent). */
function longestIncreasing(values) {
  const tails = [];
  const previous = new Array(values.length).fill(-1);
  values.forEach((value, i) => {
    if (value < 0) return;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[i] = tails[low - 1];
    tails[low] = i;
  });
  const run = new Set();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]) run.add(i);
  return run;
}

/**
 * Make `parent`'s children the elements for `items`, in order. Each item is
 * { key, sig, build: () => Element, update?: (element) => void }: `build`
 * makes a new element; `update` is given a kept one to refresh any part of it
 * that isn't in its sig.
 */
export function patchChildren(parent, items) {
  const current = Array.from(parent.children);
  const byKey = new Map(current.filter((el) => built.has(el)).map((el) => [built.get(el).key, el]));
  const nodes = items.map((item) => {
    const old = byKey.get(item.key);
    // An element is used once: a second item with the same key gets its own.
    byKey.delete(item.key);
    if (old && built.get(old).sig === item.sig) {
      item.update?.(old);
      return old;
    }
    const element = item.build();
    built.set(element, { key: item.key, sig: item.sig });
    return element;
  });
  const wanted = new Set(nodes);
  for (const el of current) if (!wanted.has(el)) el.remove();
  // Elements already in the right order stay where they are; only the rest are moved.
  const stay = longestIncreasing(nodes.map((node) => current.indexOf(node)));
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (!stay.has(i)) parent.insertBefore(nodes[i], nodes[i + 1] ?? null);
  }
}

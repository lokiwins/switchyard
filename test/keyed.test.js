import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchChildren } from '../public/keyed.js';

/** Just enough of the DOM for patchChildren: element children, insertBefore and remove. */
class FakeElement {
  constructor(name) { this.name = name; this.parent = null; }
  get nextElementSibling() { const kids = this.parent.kids; return kids[kids.indexOf(this) + 1] ?? null; }
  remove() { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
}

class FakeParent {
  constructor(...kids) { this.kids = []; this.moves = 0; kids.forEach((k) => this.insertBefore(k, null)); this.moves = 0; }
  get firstElementChild() { return this.kids[0] ?? null; }
  get children() { return this.kids; }
  insertBefore(node, ref) {
    if (node.parent) node.remove();
    node.parent = this;
    const at = ref ? this.kids.indexOf(ref) : this.kids.length;
    this.kids.splice(at, 0, node);
    this.moves += 1;
  }
}

/** Items for patchChildren from [key, sig] pairs, counting what gets built. */
function itemsOf(pairs, built) {
  return pairs.map(([key, sig]) => ({ key, sig, build: () => { built.push(key); return new FakeElement(`${key}@${sig}`); } }));
}

const names = (parent) => parent.kids.map((k) => k.name);

test('patchChildren: the first time, builds every item, in order', () => {
  const parent = new FakeParent();
  const built = [];
  patchChildren(parent, itemsOf([['a', 1], ['b', 1], ['c', 1]], built));
  assert.deepEqual(names(parent), ['a@1', 'b@1', 'c@1']);
  assert.deepEqual(built, ['a', 'b', 'c']);
});

test('patchChildren: nothing changed → nothing built and nothing moved; the same elements stay', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1], ['b', 1]], []));
  const before = [...parent.kids];
  parent.moves = 0;
  const built = [];
  patchChildren(parent, itemsOf([['a', 1], ['b', 1]], built));
  assert.deepEqual(built, []);
  assert.equal(parent.moves, 0);
  assert.deepEqual(parent.kids, before);
});

test('patchChildren: only the item whose data changed is built again; the others are the same elements', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1], ['b', 1], ['c', 1]], []));
  const [a, , c] = parent.kids;
  const built = [];
  patchChildren(parent, itemsOf([['a', 1], ['b', 2], ['c', 1]], built));
  assert.deepEqual(built, ['b']);
  assert.deepEqual(names(parent), ['a@1', 'b@2', 'c@1']);
  assert.equal(parent.kids[0], a);
  assert.equal(parent.kids[2], c);
});

test('patchChildren: an item moving to the top moves only that element', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1], ['b', 1], ['c', 1], ['d', 1]], []));
  parent.moves = 0;
  patchChildren(parent, itemsOf([['d', 1], ['a', 1], ['b', 1], ['c', 1]], []));
  assert.deepEqual(names(parent), ['d@1', 'a@1', 'b@1', 'c@1']);
  assert.equal(parent.moves, 1);
});

test('patchChildren: an item moving down moves only that element', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1], ['b', 1], ['c', 1], ['d', 1]], []));
  parent.moves = 0;
  patchChildren(parent, itemsOf([['b', 1], ['c', 1], ['d', 1], ['a', 1]], []));
  assert.deepEqual(names(parent), ['b@1', 'c@1', 'd@1', 'a@1']);
  assert.equal(parent.moves, 1);
});

test('patchChildren: items gone are removed, new ones built in place, and anything unkeyed (a placeholder) removed', () => {
  const placeholder = new FakeElement('Scanning…');
  const parent = new FakeParent(placeholder);
  patchChildren(parent, itemsOf([['a', 1], ['b', 1]], []));
  assert.deepEqual(names(parent), ['a@1', 'b@1']);
  const built = [];
  patchChildren(parent, itemsOf([['a', 1], ['x', 1]], built));
  assert.deepEqual(names(parent), ['a@1', 'x@1']);
  assert.deepEqual(built, ['x']);
});

test('patchChildren: a kept element is passed to its item\'s update', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1]], []));
  const updated = [];
  patchChildren(parent, [{ key: 'a', sig: 1, build: () => assert.fail('kept, not built'), update: (el) => updated.push(el.name) }]);
  assert.deepEqual(updated, ['a@1']);
});

test('patchChildren: the same key in another container is not reused', () => {
  const one = new FakeParent();
  const two = new FakeParent();
  patchChildren(one, itemsOf([['a', 1]], []));
  const built = [];
  patchChildren(two, itemsOf([['a', 1]], built));
  assert.deepEqual(built, ['a']);
  assert.equal(one.kids.length, 1);
});

test('patchChildren: two items with the same key each get an element; none goes missing', () => {
  const parent = new FakeParent();
  patchChildren(parent, itemsOf([['a', 1]], []));
  patchChildren(parent, itemsOf([['a', 1], ['a', 1]], []));
  assert.equal(parent.kids.length, 2);
  assert.notEqual(parent.kids[0], parent.kids[1]);
});

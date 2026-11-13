# Vendored Cytoscape.js

`cytoscape.esm.min.mjs` is `dist/cytoscape.esm.min.mjs` from the npm package `cytoscape` 3.35.0, copied unchanged except that the `//# sourceMappingURL` line is removed. MIT-licensed (`LICENSE`). It has no dependencies.

It draws the graph page (`graph.html`). Cytoscape adds a `<style>` element for its container unless an element with the id `__________cytoscape_stylesheet` already exists; the page's Content-Security-Policy blocks inline styles, so `graph.html` has that element and `styles.css` carries the rule. To update, `npm pack cytoscape@<version>` and copy the same file.

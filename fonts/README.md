# Material Symbols subset

`material-symbols-outlined.woff2` is a subset generated from Google's [Material Symbols Outlined](https://developers.google.com/fonts/docs/material_symbols) font for the Multi-Panel and options pages. It includes the icon ligatures listed in [material-symbols-outlined-icons.json](material-symbols-outlined-icons.json) and is licensed under Apache 2.0; see [LICENSE-Apache-2.0.txt](LICENSE-Apache-2.0.txt).

To regenerate the font after changing the icon list, edit the JSON manifest and run:

```sh
node scripts/download-material-symbols-font.js
```

The script requests the named icon subset from the Google Fonts CSS2 API and saves its WOFF2 response here. The API may update the underlying font version over time. Keep the manifest synchronized with every icon name used in `multi-panel/multi-panel.html`, `multi-panel/multi-panel.js`, `options/options.html`, and `options/options.js`; `tests/material-symbols-font.test.js` checks those sources against the manifest.

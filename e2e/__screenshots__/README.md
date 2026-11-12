# Visual baselines (Linux only)

The `visual` Playwright project compares screenshots against the images that belong here: Home,
Features, Settings and Settings > AI, each in light and dark. No baselines are committed. Generate them
with:

```
npm run test:visual:update
```

They must be rendered on Linux, in the exact Playwright image the script pins
(`scripts/lib/playwrightImage.js`), or every pixel of text differs. Never commit images made on
Windows or macOS.

Until the baselines exist the `visual` project fails on Linux (Playwright writes the missing images
and reports the test as failed). That is intended: do not turn on `updateSnapshots: 'missing'`. On
other systems the project is skipped.

Review every generated image, then commit them. Layout: `<spec file name>/<screen>-<light|dark>.png`.
Upgrading `@playwright/test` is deliberate: bump the version, the image and these baselines together.

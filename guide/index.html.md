---
layout: plugin-documentation.html.ejs
title: AskashaCMS asset downloader plugin documentation
---

This plugin automatically downloads remote asset files, to make them part of the local files.  By _asset_, we mean any file that isn't rendered - an image, audio, etc - but simply copied into the rendered output directory.  A _remote asset file_ is one which is referenced by an external URL.

The purpose is to ensure the website is not dependent on any 3rd party server.  For any external image or other file, why should the website risk being down if the 3rd party server goes down?  This plugin instead ensures that external files are downloaded into a local directory, and deployed along with the rest of the static site.

# Installation

With an AkashaCMS website setup, add the following to `package.json`

```json
  "dependencies": {
    ...
    "@akashacms/plugins-dlassets": "0.9.x",
    ...
  }
```

Once added to `package.json` run: `npm install`

# Configuration

In `config.mjs` for the website:

```js
import { DownloadAssetsPlugin } from '@akashacms/plugins-dlassets';
// ...
config
    // ...
    .use(DownloadAssetsPlugin, {
      // options
    })
    // ...
    ;
```

The options argument is an optional object that can contain these fields:

* `cachedir` - A directory into which to download assets

# Operation

This plugin does not use any custom tags.  Instead it automatically scans the HTML looking for `<img>`, `<link>` and `<script>` tags.  For each, if an external URL is referenced, it will download the file into an obfuscated file name, then replace the original URL with the path of the downloaded file.



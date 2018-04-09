/**
 *
 * Copyright 2018 David Herron
 *
 * This file is part of AkashaCMS-embeddables (http://akashacms.com/).
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */


const path     = require('path');
const util     = require('util');
const url      = require('url');
const request  = require('request');
// const got      = require('got');
// const FetchStream = require("fetch").FetchStream;
const fs       = require("fs-extra");
const akasha   = require('akasharender');
const mahabhuta = akasha.mahabhuta;

const log     = require('debug')('akasha:dlassets-plugin');
const error   = require('debug')('akasha:error-dlassets-plugin');

const pluginName = "akashacms-dlassets";


module.exports = class DownloadAssetsPlugin extends akasha.Plugin {
	constructor() {
		super(pluginName);
	}

    configure(config) {
        this._config = config;
        // config.addPartialsDir(path.join(__dirname, 'partials'));
        // config.addAssetsDir(path.join(__dirname, 'assets'));
        config.addMahabhuta(module.exports.mahabhuta);
    }
}

module.exports.mahabhuta = new mahabhuta.MahafuncArray(pluginName, {});

async function downloadAsset(metadata, href, uHref, outputMode) {
    // Set up the path for the image.
    // We'll write this path into the <img> tag.
    // We'll store the file into the corresponding file on-disk.
    //
    // We need to take care with certain characters in the path.
    // For example, Amazon will use a file-name like 81yP%2B05t98L._SL1500_.jpg
    // in its images.  That '%' character causes problems when it's part
    // of a URL.  Cheerio doesn't do the right thing to encode this
    // string correctly.  What we'll do instead is hide characters that are
    // known to be dangerous, using this rewriting technique.
    var dlPath = path.join('/___dlassets',
        uHref.host ? uHref.host : "unknown-host",
        uHref.path.replace('%', '__'));
    var pathWriteTo = path.join(metadata.config.renderDestination, dlPath);

    await fs.ensureDir(path.dirname(pathWriteTo));

    /* await new Promise((resolve, reject) => {
        out = fs.createWriteStream(pathWriteTo);
        new FetchStream(href).pipe(out);
        out.on('error', err => {
            try { out.close(); } catch (e) {}
            console.error(`downloadAsset ERROR on ${href} ${err.stack}`);
            reject(err);
        });
        out.on('finish', () => { resolve(); });
    }); */

    var res = await new Promise((resolve, reject) => {
        request({ url: href, encoding: null }, (error, response, body) => {
            if (error) reject(error);
            else resolve({response, body});
        });
    });

    // const res = await got(href);
    await fs.writeFile(pathWriteTo, res.body, outputMode);

    /* out = fs.createWriteStream(pathWriteTo);
    got.stream(href).pipe(out);
    await new Promise((resolve, reject) => {
        out.on('error', err => {
            try { out.close(); } catch (e) {}
            console.error(`downloadAsset ERROR on ${href} ${err.stack}`);
            reject(err);
        });
        out.on('finish', () => { resolve(); });
    }); */

    return { dlPath, pathWriteTo };
}

class ExternalImageDownloader  extends mahabhuta.Munger {
    get selector() { return 'html body img'; }
    async process($, $img, metadata, dirty) {
        const src   = $img.attr('src');
        if (!src) return "ok";
        const uHref = url.parse(src, true, true);
        if (uHref.host && uHref.host === 'www.google.com' && uHref.path.startsWith('/s2/favicons')) {
            // Special case, do not download favicons from Google's favicon service
            return "ok";
        }
        if (uHref.protocol || uHref.slashes || uHref.host) {
            const { dlPath, pathWriteTo } = await downloadAsset(metadata, src, uHref, 'binary');
            $img.attr('src', dlPath);
            $img.attr('data-orig-src', src);
        }
        return "ok";
    }
}
module.exports.mahabhuta.addMahafunc(new ExternalImageDownloader());

class ExternalStylesheetDownloader  extends mahabhuta.Munger {
    get selector() { return 'html head link'; }
    async process($, $link, metadata, dirty) {
        const type   = $link.attr('type');
        const href   = $link.attr('href');
        if (!href) return "ok";
        if (type !== 'text/css') return "ok";
        const uHref = url.parse(href, true, true);
        if (uHref.protocol || uHref.slashes || uHref.host) {
            const { dlPath, pathWriteTo } = await downloadAsset(metadata, href, uHref, 'utf8');
            $link.attr('href', dlPath);
            $link.attr('data-orig-href', href);
        }
    }
}
module.exports.mahabhuta.addMahafunc(new ExternalStylesheetDownloader());

class ExternalJavaScriptDownloader  extends mahabhuta.Munger {
    get selector() { return 'html head script'; }
    async process($, $script, metadata, dirty) {
        const src   = $script.attr('src');
        if (!src) return "ok";
        const uHref = url.parse(src, true, true);
        if (uHref.protocol || uHref.slashes || uHref.host) {
            const { dlPath, pathWriteTo } = await downloadAsset(metadata, src, uHref, 'utf8');
            $script.attr('src', dlPath);
            $script.attr('data-orig-src', src);
        }
        return "ok";
    }
}
module.exports.mahabhuta.addMahafunc(new ExternalJavaScriptDownloader());

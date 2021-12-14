/**
 *
 * Copyright 2018, 2019 David Herron
 *
 * This file is part of AkashaCMS-dlassets (http://akashacms.com/).
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

// node-fetch only supports use from ESM modules
// We can use import() to load the module but that
// requires dealing with the Promise returned by import
const fetch = (...args) => import('node-fetch')
            .then(({default: fetch}) => fetch(...args));

// stream.pipeline is used for saving to disk
// But it is a callbacks function, so we use util.promisify
const stream   = require('stream');
const dopipeline = util.promisify(stream.pipeline);

const fs       = require("fs-extra");
const akasha   = require('akasharender');
const mahabhuta = akasha.mahabhuta;

const pluginName = "akashacms-dlassets";

const _plugin_config = Symbol('config');
const _plugin_options = Symbol('options');

module.exports = class DownloadAssetsPlugin extends akasha.Plugin {
	constructor() {
		super(pluginName);
	}

    configure(config, options) {
        this[_plugin_config] = config;
        this[_plugin_options] = options;
        options.config = config;
        // console.log(`${pluginName} options ${util.inspect(options)} this.options ${util.inspect(this.options)}`);
        // config.addPartialsDir(path.join(__dirname, 'partials'));
        // config.addAssetsDir(path.join(__dirname, 'assets'));
        config.addMahabhuta(module.exports.mahabhutaArray(options));
    }

    get config() { return this[_plugin_config]; }
    get options() { return this[_plugin_options]; }

}

module.exports.mahabhutaArray = function(options) {
    let ret = new mahabhuta.MahafuncArray(pluginName, options);
    ret.addMahafunc(new ExternalImageDownloader());
    ret.addMahafunc(new ExternalStylesheetDownloader());
    ret.addMahafunc(new ExternalJavaScriptDownloader());
    return ret;
};

const hrefsDownloaded = new Map();

// TODO
//
// Handle outputMode binary vs utf8
//
// Reorganize into this process
//
//    1. compute dlDir = path.join('/___dlassets', dlpath_host)
//    2. ensure that directory exists
//    3. start fetch
//    4. Throw error if it fails
//    5. Hash uHref.path making sure it is a legit pathname
//    6. Depending on response.headers.get('content-type)
//       append a file extension to the encoded path
//    7. compute dlPath = path.join(dlDir, encoded-path-and-extension)
//    8. stream response.body to that file ensuring it is in correct mode

async function downloadAsset(config, options, href, uHref, outputMode) {

    if (hrefsDownloaded.has(href)) {
        // console.log(`downloadAsset cache-hit ${href}`);
        return hrefsDownloaded.get(href);
    }

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

    // console.log(`downloadAsset downloading '${uHref.host}' '${uHref.path}'`);

    const dlpath_host = uHref.host
            ? uHref.host.replace('.', '_').replace('.', '_')
            : "unknown-host";
    // TODO - Instead of this, generate a hash of the path
    const dlpath_path = uHref.path.replace('%', '__');

    const dlPath = path.join('/___dlassets', dlpath_host, dlpath_path);;

    let pathWriteTo;
    let pathRenderTo;

    if (options && options.cachedir) {
        pathWriteTo = path.join(options.cachedir, dlPath);
        pathRenderTo = path.join(config.renderDestination, dlPath);
        // console.log(`downloadAsset cachedir ${thisPlugin.options.cachedir} pathWriteTo ${pathWriteTo} pathRenderTo ${pathRenderTo}`);
        if (await fs.pathExists(pathWriteTo)) {
            let stats = await fs.stat(pathWriteTo);
            let age = (new Date() - stats.mtime) / 1000;
            let seven_days = (7 * 24 * 60 * 60);
            if (age < seven_days) { // younger than 7 days
                let ret = { dlPath, pathRenderTo };
                hrefsDownloaded.set(href, ret);
                // console.log(`downloadAsset found ${dlPath} => ${pathRenderTo}`);
                return ret;
            } /* else {
                console.log(`downloadAsset age ${dlPath} => ${pathWriteTo} too old ${age} seven_days ${seven_days}`);
            } */
        }
    } else {
        pathWriteTo = pathRenderTo = path.join(config.renderDestination, dlPath);
        // console.log(`downloadAsset NO cachedir pathWriteTo ${pathWriteTo}`);
    }

    // var pathWriteTo = path.join(metadata.config.renderDestination, dlPath);

    if (!uHref.protocol) {
        uHref.protocol = 'http';
        href = url.format(uHref);
        // console.log(`downloadAsset NO PROTOCOL change href to ${href} ${util.inspect(uHref)}`);
    }

    await fs.ensureDir(path.dirname(pathWriteTo));

    const response = await fetch(href);
    if (!response.ok) {
        throw new Error(`downloadAsset FAIL ${response.statusText} for ${href}`);
    }

    // This lets us see the details of the data structure 
    // returned by fetch

    /* console.log(`downloadAsset ${href} `, {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers.raw(),
        contentType: response.headers.get('content-type')
    }); */

    await dopipeline(response.body, fs.createWriteStream(pathWriteTo));

    // console.log(`downloadAsset ${href} writeFile ${dlPath} => ${pathWriteTo}`);
    if (pathWriteTo !== pathRenderTo) {
        await fs.ensureDir(path.dirname(pathRenderTo));
        // console.log(`downloadAsset copy ${dlPath} => ${pathRenderTo}`);
        await fs.copy(pathWriteTo, pathRenderTo);
    }

    let ret = { dlPath, pathRenderTo };
    hrefsDownloaded.set(href, ret);
    return ret;
}

var imgnum = 0;

class ExternalImageDownloader  extends mahabhuta.Munger {
    get selector() { return 'html body img'; }
    async process($, $img, metadata, dirty) {
        const src   = $img.attr('src');
        if (!src) return "ok";

        // There are various reasons to not download images.  For any
        // such instance, we simply return rather than proceeding with
        // calling downloadAsset

        if (typeof $img.prop('nodownload') !== 'undefined') return "ok";
        const uHref = url.parse(src, true, true);
        if (uHref.host && uHref.host === 'www.google.com' && uHref.path.startsWith('/s2/favicons')) {
            // Special case, do not download favicons from Google's favicon service
            return "ok";
        }
        if (uHref.host
         && uHref.host === 'www.plantuml.com'
         && uHref.path.startsWith('/plantuml')) {
            let ext;
            if (uHref.path.startsWith('/plantuml/svg')) ext = 'svg';
            else if (uHref.path.startsWith('/plantuml/png')) ext = 'png';
            else throw new Error(`Unknown plantuml image type in ${src}`);
            uHref.path = `/image${imgnum++}.${ext}`;
        }
        if (uHref.protocol || uHref.slashes || uHref.host) {
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                        this.array.options.config, this.array.options, src, uHref, 'binary');
                $img.attr('src', dlPath);
                $img.attr('data-orig-src', src);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalImageDownloader for URL ${src}: ${e.stack}`);
                $img.attr('src', src);
            }
        }
        return "ok";
    }
}

class ExternalStylesheetDownloader  extends mahabhuta.Munger {
    get selector() { return 'html head link'; }
    async process($, $link, metadata, dirty) {
        const type   = $link.attr('type');
        const href   = $link.attr('href');
        if (!href) return "ok";
        if (type !== 'text/css') return "ok";
        const uHref = url.parse(href, true, true);
        if (uHref.protocol || uHref.slashes || uHref.host) {
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                    this.array.options.config, this.array.options, href, uHref, 'utf8');
                $link.attr('href', dlPath);
                $link.attr('data-orig-href', href);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalStylesheetDownloader for URL ${href}: ${e.stack}`);
                $link.attr('href', href);
            }
        }
    }
}

class ExternalJavaScriptDownloader  extends mahabhuta.Munger {
    get selector() { return 'html head script'; }
    async process($, $script, metadata, dirty) {
        const src   = $script.attr('src');
        if (!src) return "ok";
        const uHref = url.parse(src, true, true);
        if (uHref.protocol || uHref.slashes || uHref.host) {
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                    this.array.options.config, this.array.options, src, uHref, 'utf8');
                $script.attr('src', dlPath);
                $script.attr('data-orig-src', src);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalJavaScriptDownloader for URL ${src}: ${e.stack}`);
                $script.attr('src', src);
            }
        }
        return "ok";
    }
}

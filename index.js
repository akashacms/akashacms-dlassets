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
const fs       = require("fs-extra");
const akasha   = require('akasharender');
const mahabhuta = akasha.mahabhuta;

const pluginName = "akashacms-dlassets";


module.exports = class DownloadAssetsPlugin extends akasha.Plugin {
	constructor() {
		super(pluginName);
	}

    configure(config, options) {
        this._config = config;
        this.options = !options ? {} : options;
        console.log(`${pluginName} options ${util.inspect(options)} this.options ${util.inspect(this.options)}`);
        // config.addPartialsDir(path.join(__dirname, 'partials'));
        // config.addAssetsDir(path.join(__dirname, 'assets'));
        config.addMahabhuta(module.exports.mahabhuta);
    }
}

module.exports.mahabhuta = new mahabhuta.MahafuncArray(pluginName, {});

const hrefsDownloaded = new Map();

async function downloadAsset(metadata, href, uHref, outputMode) {

    if (hrefsDownloaded.has(href)) {
        // console.log(`downloadAsset cache-hit ${href}`);
        return hrefsDownloaded.get(href);
    }

    const thisPlugin = metadata.config.plugin(pluginName);

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
    var dlPath = path.join('___dlassets',
        // Obfuscate the host name a bit
        uHref.host ? uHref.host.replace('.', '_').replace('.', '_') : "unknown-host",
        uHref.path.replace('%', '__'));

    let pathWriteTo;
    let pathRenderTo;

    if (thisPlugin.options && thisPlugin.options.cachedir) {
        pathWriteTo = path.join(thisPlugin.options.cachedir, dlPath);
        pathRenderTo = path.join(metadata.config.renderDestination, dlPath);
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
        pathWriteTo = pathRenderTo = path.join(metadata.config.renderDestination, dlPath);
        // console.log(`downloadAsset NO cachedir pathWriteTo ${pathWriteTo}`);
    }

    // var pathWriteTo = path.join(metadata.config.renderDestination, dlPath);

    if (!uHref.protocol) {
        uHref.protocol = 'http';
        href = url.format(uHref);
        // console.log(`downloadAsset NO PROTOCOL change href to ${href} ${util.inspect(uHref)}`);
    }

    await fs.ensureDir(path.dirname(pathWriteTo));

    var res = await new Promise((resolve, reject) => {
        request({ 
            url: href,
            encoding: outputMode === 'binary' ? null : 'utf8'
        }, (error, response, body) => {
            if (error) reject(error);
            else resolve({response, body});
        });
    });

    // console.log(`downloadAsset writeFile ${dlPath} => ${pathWriteTo}`);
    await fs.writeFile(pathWriteTo, res.body, outputMode);
    if (pathWriteTo !== pathRenderTo) {
        await fs.ensureDir(path.dirname(pathRenderTo));
        // console.log(`downloadAsset copy ${dlPath} => ${pathRenderTo}`);
        await fs.copy(pathWriteTo, pathRenderTo);
    }

    let ret = { dlPath, pathRenderTo };
    hrefsDownloaded.set(href, ret);
    return ret;
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
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(metadata, src, uHref, 'binary');
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
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(metadata, href, uHref, 'utf8');
                $link.attr('href', dlPath);
                $link.attr('data-orig-href', href);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalStylesheetDownloader for URL ${href}: ${e.stack}`);
                $link.attr('href', href);
            }
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
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(metadata, src, uHref, 'utf8');
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
module.exports.mahabhuta.addMahafunc(new ExternalJavaScriptDownloader());

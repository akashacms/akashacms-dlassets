/**
 *
 * Copyright 2018-2025 David Herron
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

import path from 'node:path';
import util from 'node:util';
import url from 'node:url';
import fs, { promises as fsp } from 'node:fs';

import got from 'got';

import mime from 'mime';
import bs58 from 'bs58';

import akasha, {
    Configuration,
    CustomElement,
    Munger,
    PageProcessor
} from 'akasharender';
const mahabhuta = akasha.mahabhuta;

const __dirname = import.meta.dirname;

const pluginName = "@akashacms/plugins-dlassets";

export class DownloadAssetsPlugin extends akasha.Plugin {
	constructor() {
		super(pluginName);
	}

    #config;

    configure(config, options) {
        this.#config = config;
        // this.config = config;
        this.akasha = config.akasha;
        this.options = options ? options : {};
        this.options.config = config;
        // console.log(`${pluginName} options ${util.inspect(options)} this.options ${util.inspect(this.options)}`);
        // config.addPartialsDir(path.join(__dirname, 'partials'));
        // config.addAssetsDir(path.join(__dirname, 'assets'));
        config.addMahabhuta(mahabhutaArray(options, config, this.akasha, this));
    }

    get config() { return this.#config; }

}

export function mahabhutaArray(
    options,
    config, // ?: Configuration,
    akasha, // ?: any,
    plugin  // ?: Plugin
) {
    let ret = new mahabhuta.MahafuncArray(pluginName, options);
    ret.addMahafunc(new ExternalImageDownloader(config, akasha, plugin));
    ret.addMahafunc(new ExternalStylesheetDownloader(config, akasha, plugin));
    ret.addMahafunc(new ExternalJavaScriptDownloader(config, akasha, plugin));
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

    // The file name to construct is:
    //
    //    /__dlassets/host_name/ENCODED-FN.ext
    //
    // The host_name is the host from the href, with some characters
    // changed to make it safer as a file name
    //
    // The ENCODED-FN is because for some URLs the path string
    // is very complex and decidedly not safe as a file name.
    // What we want to do is concatenate every portion of
    // the parsed URL which is the path, namely the path,
    // the search string, and the hash string.  That full path
    // is then encoded in BASE58, which is safe for use
    // in the file system.

    const dlpath_host = uHref.host
            ? uHref.host.replace('.', '_').replace('.', '_')
            : "unknown-host";

    // Construct the full path string, then encode it as a string
    // which is safe to be used as a file name
    const fullpath = uHref.pathname + uHref.search + uHref.hash;
    const fnbytes = Buffer.from(fullpath);
    const bs58fn  = bs58.encode(fnbytes);

    const dlDir  = path.join('/___dlassets', dlpath_host);

    let dirWriteTo;
    let dirRenderTo;
    if (options && options.cachedir) {
        dirWriteTo = path.join(options.cachedir, dlDir);
        dirRenderTo = path.join(config.renderDestination, dlDir);
    } else {
        dirWriteTo = dirRenderTo = path.join(config.renderDestination, dlDir);
        // console.log(`downloadAsset NO cachedir pathWriteTo ${pathWriteTo}`);
    }

    let pathWriteTo;
    let pathRenderTo;

    if (!uHref.protocol) {
        uHref.protocol = 'http';
        href = uHref.toString(); //  url.format(uHref);
        // console.log(`downloadAsset NO PROTOCOL change href to ${href} ${util.inspect(uHref)}`);
    }

    // console.log(`downloadAsset dlDir ${dlDir} dlpath_host ${dlpath_host} dirWriteTo ${dirWriteTo} dirRenderTo ${dirRenderTo}`);
    await fsp.mkdir(dirWriteTo, { recursive: true });
    await fsp.mkdir(dirRenderTo, { recursive: true });

    // Start the download here
    //
    // The response object contains the Content-Type from which we get
    // the file name extension to use.

    const promise = got.get(href, {
        responseType: 'buffer',
        followRedirect: true
    });
    const response = await promise;
    if (!(
        response.complete
     && response.statusCode === 200
     && response.statusMessage === 'OK'
    )) {
        throw new Error(`downloadAsset FAIL ${response.statusMessage} for ${href} ${util.inspect({   
            ok: response.ok,
            complete: response.complete,
            statusCode: response.statusCode,
            status: response.status,
            statusMessage: response.statusMessage,
            headers: response.headers,
            contentType: response.headers['content-type'],
            url: response.url
        })}`);
    }

    const dlFN = bs58fn.substring(0, 60)
            +'.'+ mime.getExtension(response.headers['content-type']);
    const dlPath = path.join(dlDir, dlFN);
    pathWriteTo = path.join(dirWriteTo, dlFN);
    pathRenderTo = path.join(dirRenderTo, dlFN);

    /* console.log(`downloadAsset ${href} dlDir ${dlDir} dlPath ${dlPath} `, {
        ok: response.ok,
        complete: response.complete,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        url: response.url,
        headers: response.headers,
        contentType: response.headers['content-type'],
    }); */

    await fsp.writeFile(pathWriteTo, await promise.buffer());

    // I tried writing all this by doing a stream from Got
    // to a fs.createWriteStream but that didn't work.  This
    // solution of bringing the response into a Buffer etc is
    // less than ideal because of memory use.

    // console.log(`downloadAsset ${href} writeFile ${dlPath} => ${pathWriteTo}`);
    if (pathWriteTo !== pathRenderTo) {
        await fsp.mkdir(path.dirname(pathRenderTo), { recursive: true });
        // console.log(`downloadAsset copy ${dlPath} => ${pathRenderTo}`);
        await fsp.copyFile(pathWriteTo, pathRenderTo);
    }

    let ret = { dlPath, pathRenderTo };
    hrefsDownloaded.set(href, ret);
    return ret;
}

var imgnum = 0;

class ExternalImageDownloader  extends Munger {
    get selector() { return 'html body img'; }
    async process($, $img, metadata, dirty) {
        const src   = $img.attr('src');
        if (!src) return "ok";

        // There are various reasons to not download images.  For any
        // such instance, we simply return rather than proceeding with
        // calling downloadAsset

        if (typeof $img.prop('nodownload') !== 'undefined') return "ok";
        const uHref = new URL(src, 'http://example.com');
        if (uHref.host
         && uHref.host === 'www.google.com'
         && uHref.pathname.startsWith('/s2/favicons')) {
            // Special case, do not download favicons from Google's favicon service
            return "ok";
        }
        if (uHref.host
         && uHref.host === 'www.plantuml.com'
         && uHref.pathname.startsWith('/plantuml')) {
            let ext;
            if (uHref.pathname.startsWith('/plantuml/svg')) ext = 'svg';
            else if (uHref.pathname.startsWith('/plantuml/png')) ext = 'png';
            else throw new Error(`Unknown plantuml image type in ${src}`);
            uHref.pathname = `/image${imgnum++}.${ext}`;
        }
        if (uHref.origin !== 'http://example.com' ) {
            // Not a Local URL
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                        this.config, this.options, src, uHref, 'binary');
                $img.attr('src', dlPath);
                $img.attr('data-orig-src', src);
                // console.log(`ExternalImageDownloader ${src} ==> ${dlPath}`);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalImageDownloader for URL ${src}: ${e.stack}`);
                $img.attr('src', src);
            }
        }
        return "ok";
    }
}

class ExternalStylesheetDownloader  extends Munger {
    get selector() { return 'html head link'; }
    async process($, $link, metadata, dirty) {
        const type   = $link.attr('type');
        const href   = $link.attr('href');
        if (!href) return "ok";
        if (type !== 'text/css') return "ok";
        const uHref = new URL(href, 'http://example.com');
        if (uHref.origin !== 'http://example.com') {
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                    this.config, this.options, href, uHref, 'utf8');
                $link.attr('href', dlPath);
                $link.attr('data-orig-href', href);
                // console.log(`ExternalStylesheetDownloader ${src} ==> ${dlPath}`);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalStylesheetDownloader for URL ${href}: ${e.stack}`);
                $link.attr('href', href);
            }
        }
    }
}

class ExternalJavaScriptDownloader  extends Munger {
    get selector() { return 'html head script'; }
    async process($, $script, metadata, dirty) {
        const src   = $script.attr('src');
        if (!src) return "ok";
        const uHref = new URL(src, 'http://example.com')
        if (uHref.origin !== 'http://example.com') {
            try {
                const { dlPath, pathWriteTo } = await downloadAsset(
                    this.config, this.options, src, uHref, 'utf8');
                $script.attr('src', dlPath);
                $script.attr('data-orig-src', src);
                // console.log(`ExternalJavaScriptDownloader ${src} ==> ${dlPath}`);
            } catch (e) {
                console.log(`IGNORE ERROR akashacms-dlassets ExternalJavaScriptDownloader for URL ${src}: ${e.stack}`);
                $script.attr('src', src);
            }
        }
        return "ok";
    }
}

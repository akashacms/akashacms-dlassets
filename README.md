This [AkashaCMS](https://akashacms.com) plugin automatically downloads remote asset files, to make them part of the local files.  

The originating purpose is that EPUB files cannot have remote asset files like images or stylesheets.  Obviously an EPUB reader might not have Internet access or even have a TCP/IP stack, and therefore the EPUB reader cannot fetch remote stylesheets, and therefore EPUB's must be standalone.  For that purpose some code exists in the [akasharender-epub](https://github.com/akashacms/akasharender-epub) package to download images.

After reflection I recognized this was a generic need.  For example advertising images might be blocked if an adblocker is detecting advertising images based on URL.  To avoid that result, if the advertising image is downloaded into the rendered website, the adblocker won't detect the image and won't block it.

Another higher purpose is to not rely on 3rd party CDN's for JavaScript or CSS files in frameworks like Bootstrap.  Typically the maker of these frameworks tell us to use their CDN for the files.  What if their CDN goes down, why should our website have to go down?  Therefore, if we can automatically download such assets while rendering the website, our website will be safe from CDN outages.

**Definition** "Asset" means any file that isn't rendered - an image, audio, etc - but simply copied into the rendered output directory.
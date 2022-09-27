import https from 'https';
import http from 'http'
import fs from 'node:fs';
// import process from 'node:process';

const timeout = 12000;

// https://stackoverflow.com/questions/11944932/how-to-download-a-file-with-node-js-without-using-third-party-libraries/11944984#11944984
export function downloadImg(url, dest) {
    const pkg = url.toLowerCase().startsWith('https:') ? https : http

    return new Promise((resolve, reject) => {
        /** 
         * NOTE: Do not use fs.access() to check for the accessibility of a file,
         * since other processes may change the file's state between the two calls.
         * https://nodejs.org/api/fs.html#fsaccesspath-mode-callback
         */
        const request = pkg.get(url).on('response', (res) => {
            if (res.statusCode === 200) {
                const fileStream = fs.createWriteStream(dest, {
                    flags: 'wx' // https://nodejs.org/api/fs.html#file-system-flags
                })
                res
                    .on('end', () => {
                        /**
                         * NOTE: Readable stream fires only end and never finish.
                         * Writable stream fires only finish and never end.
                         * https://stackoverflow.com/a/34310963/18513152
                         */
                        fileStream.end();
                        resolve();
                    })
                    .on('error', (err) => {
                        // https://nodejs.org/dist/latest-v16.x/docs/api/fs.html#filehandlecreatewritestreamoptions
                        // https://nodejs.org/api/stream.html#writabledestroyerror 
                        fileStream.destroy();
                        // if (err.code === 'EEXIST') reject('File already exists');
                        fs.unlink(dest, () => reject(err.message));
                    })
                    .pipe(fileStream); // Transform a Readable source into a Writable destination.
            } else if (res.statusCode === 302 || res.statusCode === 301) {
                // Recursively follow redirects, only a 200 OK status will resolve.
                downloadImg(res.headers.location, dest).then(() => resolve());
            } else {
                reject(new Error(`Download failed, request: ${url}, response status: ${res.statusCode} ${res.statusMessage}`));
            }
        });

        // https://stackoverflow.com/questions/6214902/how-to-set-a-timeout-on-a-http-request-in-node
        request
            .setTimeout(timeout, () => {
                request.destroy();
                reject(new Error(`Request: ${url} timeout after ${timeout}ms`));
            })
            .on('error', (err) => { // https://stackoverflow.com/a/50821286/18513152
                if (err.code === 'ECONNRESET') { return; }
            })
            .end(); // https://stackoverflow.com/questions/16995184/nodejs-what-does-socket-hang-up-actually-mean

        // https://stackoverflow.com/questions/61824057/error-event-handler-not-handling-econnreset/61843715#61843715
        // process.on('uncaughtException', (err) => {})
    });
}
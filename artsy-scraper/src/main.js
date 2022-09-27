import { Actor } from 'apify';
import { PuppeteerCrawler, log } from 'crawlee';
import { router } from './routes.js';

log.setLevel(log.LEVELS.DEBUG);

log.debug('Setting up crawler.');

/** 
 * Use platform storage in a local actor.
 * https://crawlee.dev/docs/guides/apify-platform
 * https://apify.github.io/apify-sdk-js/docs/guides/result-storage
 */
const dataset1 = process.env.CRAWLEE_DEFAULT_DATASET_ID.split(' ')[1];
const errorReport = await Actor.openDataset(dataset1, {
    forceCloud: true // Cloud storage will be used instead of the folder on the local disk.
});

// Create an instance based on the auto proxy group, which selects IP addresses from all available groups.
// https://sdk.apify.com/docs/guides/proxy-management
const proxyConfiguration = await Actor.createProxyConfiguration();

// PuppeteerCrawler runs a headless browser, 
// allowing access to elements or attributes generated dynamically (JavaScript rendering structure or content).
const crawler = new PuppeteerCrawler({
    launchContext: {
        launchOptions: {
            useChrome: true,
            stealth: true,
            headless: true,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--no-zygote', '--disable-gpu', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    },

    proxyConfiguration,
    /** 
     * NOTE: Activates the ​Session Pool
     * to handle the rotation of proxy IP addresses along with cookies and other identifiers
     * to reduce the chance of being blocked. 
     */
    useSessionPool: true,
    // Overrides default Session pool configuration.
    sessionPoolOptions: { maxPoolSize: 100 },
    persistCookiesPerSession: true,

    maxConcurrency: 50, // Be nice to the websites. Remove to unleash full power.
    maxRequestRetries: 10, // https://github.com/apify/crawlee/discussions/1231
    maxRequestsPerMinute: 200, // Ensure the crawler never exceeds 200 requests per minute.
    requestHandlerTimeoutSecs: 100, // https://crawlee.dev/api/browser-crawler/interface/BrowserCrawlerOptions#requestHandlerTimeoutSecs

    /** 
     * NOTE: Should always throw exceptions rather than catch them.
     * If the function throws an exception, the crawler will try to re-crawl the request later, up to the maxRequestRetries times. 
     * If all the retries fail, the crawler calls the function provided to the failedRequestHandler parameter.
     * https://crawlee.dev/api/jsdom-crawler/interface/JSDOMCrawlerOptions#requestHandler
     */
    requestHandler: router,

    // This function is called if the page processing failed more than maxRequestRetries+1 times.
    failedRequestHandler({ request }) {
        log.error(`Request ${request.url} failed too many times.`);

        // https://crawlee.dev/api/puppeteer-crawler/class/PuppeteerCrawler
        errorReport.pushData({ url: request.url, errors: request.errorMessages })
    },

    browserPoolOptions: {
        // useFingerprints: false,
        useFingerprints: true, // This is the default.
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: [
                    'chrome',
                    'firefox',
                ],
                devices: [
                    'mobile',
                ],
                locales: [
                    'en-US',
                ],
            },
        },
    },
});

log.debug('Starting with the Genome Project page.');
await crawler.addRequests(['https://www.artsy.net/categories']);

await crawler.run();

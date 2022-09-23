import { Actor } from 'apify';
import { createPuppeteerRouter, puppeteerUtils, log } from 'crawlee';
import 'dotenv/config';

const remoteStore = await Actor.openKeyValueStore(
    process.env.CRAWLEE_DEFAULT_KEY_VALUE_STORE_ID, {
        forceCloud: true
    });

// https://stackoverflow.com/questions/31552125/defining-an-array-as-an-environment-variable-in-node-js
const dataset2 = process.env.CRAWLEE_DEFAULT_DATASET_ID.split(' ')[2];
const remoteDataset = await Actor.openDataset(dataset2, {
    forceCloud: true
});

export const router = createPuppeteerRouter();

router.addDefaultHandler(async ({
    page,
    enqueueLinks
}) => {
    log.debug(`Handle gene categories`)

    // Target links within the Styles and Movements classification.
    await page.waitForSelector('#jump--styles-and-movements a[href*="/gene/85-new-wave"] div');

    await enqueueLinks({
        selector: '#jump--styles-and-movements a[href*="/gene/85-new-wave"]',
        label: 'CATEGORY'
    });

    const genes = await page.$$eval('#jump--styles-and-movements a[href*="/gene/85-new-wave"] div', (element) => {
        return element.map(characteristics => characteristics.textContent);
    });

    await remoteStore.setValue('genes', genes);
});

// Enqueue all page links first, a safer and faster practice than finding the next link on each page.
router.addHandler('CATEGORY', async ({
    request,
    page,
    enqueueLinks
}) => {
    log.debug(`Handle number-based pagination`);

    // https://stackoverflow.com/questions/56043748/detecting-if-an-element-is-visible-on-the-page-with-javascript-or-puppeteer
    const findPagination = await page.$('nav[aria-label="Pagination"]'); // Returns a promise or null.
    const multiplePages = findPagination;

    if (multiplePages) {
        // https://developers.apify.com/academy/puppeteer-playwright/common-use-cases/paginating-through-results#page-number-based-pagination
        await page.waitForSelector('nav[aria-label="Pagination"] div a[href*="gene"]');
        const pageLabel = await page.$$eval('nav[aria-label="Pagination"] div a[href*="gene"]', (element) => {
            return element.map(labels => labels.textContent);
        });

        const lastPage = Number(pageLabel[pageLabel.length - 1]);

        const pagination = [...Array(lastPage + 1).keys()].slice(1).map((pageNumber) => {
            const url = new URL(request.url);
            url.searchParams.set('page', pageNumber);
            return url.href;
        });
        await enqueueLinks({
            urls: pagination,
            label: 'PERPAGE',
        });

    } else {
        const singlePage = [request.url + '?page=1'];
        await enqueueLinks({
            urls: singlePage,
            label: 'PERPAGE',
        });
    }
});

router.addHandler('PERPAGE', async ({
    request,
    page,
    proxyInfo,
    session,
    parseWithCheerio
}) => {
    log.debug(`Extracting data: ${request.url}`);
    if (request.retryCount >= 1) log.debug(`Processing ${request.url} in ${request.retryCount + 1} times...`);

    const gene = request.url.split(/[/\?]+/)[3];
    const pageNumber = request.url.split(/[/\?=]+/)[5];

    log.debug(`Inspect the current proxy's URL: ${proxyInfo.url}`);
    const title = await page.title();

    if (title === 'Blocked') {
        session.retire();
    } else if (title === 'Not sure if blocked, might also be a connection error') {
        session.markBad();
    } else {
        // session.markGood() - this step is done automatically in PuppeteerCrawler.
    }

    // Scroll down the dynamtic page to load Lazy-loaded items. 
    // https://developers.apify.com/academy/web-scraping-for-beginners/crawling/dealing-with-dynamic-pages#scraping-dynamic-content
    await puppeteerUtils.infiniteScroll(page, {
        timeoutSecs: 5
    });

    // Waiting logic: https://docs.apify.com/tutorials/scraping-dynamic-content#quick-summary
    await page.waitForSelector('div > a > div > div > img', {
        visible: true
    });

    const allArtworksLoaded = () => {
        const numberOfArtworks = page.$$('div > a > div > div > img').length;
        const items = page.$$('div[data-test="artworkGridItem"]').length;
        return numberOfArtworks === items;
    };

    // await page.waitForFunction(allArtworksLoaded, { timeout: 60000 });

    // Extract the page's HTML from browser and parse it with Cheerio.
    const $ = await parseWithCheerio();

    const artworks = $('div[data-test="artworkGridItem"]');

    const scrapedData = [...artworks].map((element, index) => {
        const artwork = $(element);

        const count = (pageNumber - 1) * 30 + (index + 1);
        const imageUrl = artwork.find('img[class*="LazyImage"]').attr('src');
        const artist = artwork.find('div[display="flex"] div[font-family="sans"]').text();
        const title = artwork.find('a > div > div > div > i').text();

        // https://crawlee.dev/docs/introduction/scraping
        return {
            gene,
            pageNumber,
            count,
            imageUrl,
            artist,
            title
        };
    });

    await remoteDataset.pushData(scrapedData);
});
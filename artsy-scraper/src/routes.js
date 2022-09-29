import { Actor } from 'apify';
import { createPuppeteerRouter, log } from 'crawlee';
import 'dotenv/config';

const remoteStore = await Actor.openKeyValueStore(process.env.CRAWLEE_DEFAULT_KEY_VALUE_STORE_ID, { forceCloud: true });

// https://stackoverflow.com/questions/31552125/defining-an-array-as-an-environment-variable-in-node-js
const dataset = process.env.CRAWLEE_DEFAULT_DATASET_ID.split(' ')[0];
const remoteDataset = await Actor.openDataset(dataset, { forceCloud: true });

export const router = createPuppeteerRouter();

router.addDefaultHandler(async ({ page, enqueueLinks }) => {
    log.debug(`Handling gene categories`)

    await page.waitForSelector('#jump--styles-and-movements a[href*="/gene/"] div');

    await enqueueLinks({
        selector: '#jump--styles-and-movements a[href*="/gene/"]',
        label: 'CATEGORY'
    });

    const genes = await page.$$eval('#jump--styles-and-movements a[href*="/gene/"] div', (element) => {
        return element.map(styleOrMovement => styleOrMovement.textContent);
    });

    await remoteStore.setValue('geneList', genes);
});

// Ensure all page links are enqueue, a safer and faster practice than finding the next link on each page.
router.addHandler('CATEGORY', async ({ request, page, enqueueLinks }) => {
    log.debug(`Enqueueing number-based pagination:`);

    // https://stackoverflow.com/questions/56043748/detecting-if-an-element-is-visible-on-the-page-with-javascript-or-puppeteer
    const artworksAvailable = await page.$('div[class*="ArtworkGrid__InnerContainer"]'); // Returns a promise or null.

    if (artworksAvailable) {
        const findPagination = await page.$('nav[aria-label="Pagination"]');
        const hasMultiplePages = findPagination;

        if (hasMultiplePages) {
            // https://developers.apify.com/academy/puppeteer-playwright/common-use-cases/paginating-through-results#page-number-based-pagination
            await page.waitForSelector('nav[aria-label="Pagination"] div a[href*="gene"]');
            const pageLabel = await page.$$eval('nav[aria-label="Pagination"] div a[href*="gene"]', (element) => {
                return element.map(label => label.textContent);
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
    };
});

router.addHandler('PERPAGE', async ({ request, page, proxyInfo, session, parseWithCheerio, enqueueLinks }) => {
    log.debug(`Extracting data: ${request.url}`)
    if (request.retryCount >= 1) log.debug(`Processing ${request.url} in ${request.retryCount + 1} times...`)

    const gene = request.url.split(/[/\?]+/)[3];
    const pageNumber = request.url.split(/[/\?=]+/)[5];

    log.debug(`Inspecting the current proxy's URL: ${proxyInfo.url}`)
    const title = await page.title();

    // https://crawlee.dev/docs/guides/session-management
    if (title === 'Blocked') {
        session.retire();
    } else if (title === 'Not sure if blocked, might also be a connection error') {
        session.markBad();
    } else {
        // session.markGood() - this step is done automatically in PuppeteerCrawler.
    }

    // Scroll to each item and wait for a second, instead of using infiniteScroll to scroll down quickly.
    // https://stackoverflow.com/a/55600970/18513152
    await page.evaluate(async () => {
        // https://www.youtube.com/watch?v=AwyoVjVXnLk&list=PLRqwX-V7Uu6bKLPQvPRNNE65kBL62mVfx&index=2
        const delay = (msec) => {
            return new Promise(resolve => setTimeout(resolve, msec));
        };

        const gridItems = [...document.querySelectorAll('div[data-test="artworkGridItem"]')];
        for (const item of gridItems) {
            item.scrollIntoView();
            await delay(1000);
        };
    });

    const scrapedData = [];
    // Parse the page's HTML with Cheerio, safely collect data in the Node.js context.
    // https://developers.apify.com/academy/puppeteer-playwright/executing-scripts/collecting-data#setup
    const $ = await parseWithCheerio();
    // https://stackoverflow.com/questions/71358654/what-is-the-correct-approach-on-making-a-for-loop-with-a-cheerio-object
    for (const artwork of $('div[data-test="artworkGridItem"]').get()) {

        const artist = $(artwork).find('div[display="flex"] div[font-family="sans"]').text();
        const title = $(artwork).find('a > div > div > div > i').text();

        const visibleImage = $(artwork).find('img[class*="LazyImage"]').attr('src');
        const artworkLink = $(artwork).find('a[href*="/artwork/"]').first().attr('href');

        const copyData = {
            gene,
            pageNumber,
            artist,
            title
        };

        if (typeof visibleImage !== 'undefined' && visibleImage !== null) {
            // https://help.apify.com/en/articles/1829103-request-labels-and-how-to-pass-data-to-other-requests
            // https://developers.apify.com/academy/expert-scraping-with-apify/solutions/actor-building#modularity
            const dataWithImgs = {
                ...copyData,
                imageUrl: visibleImage
            }
            scrapedData.push(dataWithImgs);

        } else if ((typeof visibleImage === 'undefined' || visibleImage === null) && (typeof artworkLink !== 'undefined' && artworkLink !== null)) {
            const absoluteUrl = new URL(artworkLink, 'https://www.artsy.net');
            const individualArtwork = [absoluteUrl.href];

            await enqueueLinks({
                urls: individualArtwork,
                label: 'HIDDENIMAGE',
                userData: { copyData }
            });

        } else {
            const dataWithoutImgs = { // https://stackoverflow.com/a/64954895/18513152
                ...copyData,
                imageUrl: null
            }
            scrapedData.push(dataWithoutImgs);
        }
    }

    log.debug(`Saving data: ${request.url}`)
    await remoteDataset.pushData(scrapedData);
});

router.addHandler('HIDDENIMAGE', async ({ request, page, parseWithCheerio }) => {
    log.debug(`Extracting data: ${request.url}`)

    let scrapedData;
    const { copyData } = request.userData;
    const imageRendered = await page.waitForSelector('#transitionFrom--ViewInRoom');

    if (imageRendered) {
        const $ = await parseWithCheerio();
        scrapedData = {
            ...copyData,
            imageUrl: $('#transitionFrom--ViewInRoom').attr('src')
        };

    } else {
        scrapedData = {
            ...copyData,
            imageUrl: null
        };
    }

    log.debug(`Saving data: ${request.url}`)
    await remoteDataset.pushData(scrapedData);
});

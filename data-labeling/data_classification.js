import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { downloadImg } from './image_downloader.js' 

// https://bobbyhadz.com/blog/javascript-dirname-is-not-defined-in-es-module-scope#:~:text=The%20__dirname%20or%20__,directory%20name%20of%20the%20path.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainingData = path.resolve(__dirname, 'training-data');

const rawData = readFileSync('dataset.json');
const data = JSON.parse(rawData);
const items = data.map(({ gene, imageUrl }) => ({ gene, imageUrl }));

let categories = [];
let labeledData;

const createDirectory = async () => { // https://stackoverflow.com/a/51894627/18513152
    const genes = [];
    for (const item of items) {
        genes.push(item.gene);
    }

    // https://stackoverflow.com/questions/9229645/remove-duplicate-values-from-js-array
    categories = [...new Set(genes)];

    // Execute the following only on first run.
    /* categories.forEach(gene => {
        try {
            const parentPath = path.resolve(trainingData, `${gene}`);
            mkdir(parentPath);
        } catch (err) {
            console.error(err.message);
        }
    }); */

    // https://stackoverflow.com/a/50999586/18513152
    labeledData = Object.fromEntries(categories.map(key => [key, []]));
}

const classifyData = async () => {
    // https://stackoverflow.com/questions/2218999/how-to-remove-all-duplicates-from-an-array-of-objec
    const cleanData = await items.filter((element, index, array) =>
        index === array.findIndex(i => (
            i.gene === element.gene && i.imageUrl === element.imageUrl
        ))
    );

    const keys = Object.keys(cleanData); // https://www.youtube.com/watch?v=gRNvA6c4ero&t=0s
    for (const key of keys) {
        const record = cleanData[key];
        const url = record.imageUrl;
        const gene = record.gene;
        labeledData[gene].push(url);
    }
}

const parallelDownload = async () => {
    await Promise.all([createDirectory(), classifyData()]);

    const urls = labeledData[''];

    const results = await Promise.allSettled(urls.map((url) => {
        const file = path.basename(url, '.jpg') + '.png';
        const destination = path.join(trainingData, '', file);
        return downloadImg(url, destination);
    }));

    // https://www.coreycleary.me/better-handling-of-rejections-using-promise-allsettled
    const rejectedPromises = results.filter(result => result.status === 'rejected').map(result => result.reason);
    console.log(rejectedPromises); // Print failed requests, allowing for manual recollection of missing images.
}

parallelDownload();
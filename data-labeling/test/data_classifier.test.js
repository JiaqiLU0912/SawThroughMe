import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { downloadImg } from '../image_downloader.js'

// https://bobbyhadz.com/blog/javascript-dirname-is-not-defined-in-es-module-scope#:~:text=The%20__dirname%20or%20__,directory%20name%20of%20the%20path.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imageFolder = path.resolve(__dirname, 'training-data');

const rawData = readFileSync('dataset.json');
const data = JSON.parse(rawData);
const items = data.map(({ gene, imageUrl }) => ({ gene, imageUrl }));

sequentialDownload();

const createDirectory = async () => { // https://stackoverflow.com/a/51894627/18513152
    const genes = [];
    for (const item of items) { genes.push(item.gene); }

    // https://stackoverflow.com/questions/9229645/remove-duplicate-values-from-js-array
    [...new Set(genes)].forEach(gene => {
        try {
            const parentPath = path.resolve(imageFolder, `${gene}`);
            mkdir(parentPath);
        } catch (err) {
            console.error(err.message);
        }
    });
}

const sequentialDownload = async () => {
    await createDirectory();

    // https://stackoverflow.com/questions/2218999/how-to-remove-all-duplicates-from-an-array-of-objects
    const cleanData = await items.filter((element, index, array) =>
        index === array.findIndex(i => (
            i.gene === element.gene && i.imageUrl === element.imageUrl
        ))
    );

    const keys = Object.keys(cleanData); // https://www.youtube.com/watch?v=gRNvA6c4ero&t=0s
    for (let key of keys) {
        let record = cleanData[key];
        let url = record.imageUrl;
        let gene = record.gene;

        // if (gene === '...') {
        const file = path.basename(url, '.jpg') + '.png';
        const destination = path.join(imageFolder, `${gene}`, file);

        try {
            await downloadImg(url, destination);
            console.log('Download completed');
        } catch (err) {
            console.error('Download failed', err.message);
        }
        // }
    }
}

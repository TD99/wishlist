import { env } from "$env/dynamic/private";
import { gotScraping } from "got-scraping";
import metascraper, { type Metadata } from "metascraper";
import metascraperImage from "metascraper-image";
import metascraperTitle from "metascraper-title";
import shopping from "$lib/server/shopping";

export class ProductScrapeError extends Error {
    code: "captcha" | "network";

    constructor(message: string, code: "captcha" | "network") {
        super(message);
        this.name = "ProductScrapeError";
        this.code = code;
    }
}

const scraper = metascraper([shopping(), metascraperTitle(), metascraperImage()]);

const determineProxy = (url: URL) => {
    if (url.protocol === "http:") {
        return env.http_proxy || env.HTTP_PROXY;
    }

    if (url.protocol === "https:") {
        return env.https_proxy || env.HTTPS_PROXY;
    }

    return undefined;
};

const isCaptchaResponse = (metadata: Metadata) => {
    return Boolean(metadata.image && metadata.image.toLocaleLowerCase().includes("captcha"));
};

const toNumberOrNull = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
};

const normalizeProductData = (metadata: Metadata): ProductData => {
    return {
        brand: typeof metadata.brand === "string" ? metadata.brand : null,
        name: typeof metadata.name === "string" ? metadata.name : null,
        url: typeof metadata.url === "string" ? metadata.url : null,
        image: typeof metadata.image === "string" ? metadata.image : null,
        currency: typeof metadata.currency === "string" ? metadata.currency : null,
        condition: typeof metadata.condition === "string" ? metadata.condition : null,
        sku: typeof metadata.sku === "string" ? metadata.sku : null,
        mpn: typeof metadata.mpn === "string" ? metadata.mpn : null,
        availability: typeof metadata.availability === "string" ? metadata.availability : null,
        price: toNumberOrNull(metadata.price),
        asin: typeof metadata.asin === "string" ? metadata.asin : null,
        hostname: typeof metadata.hostname === "string" ? metadata.hostname : null,
        retailer: typeof metadata.retailer === "string" ? metadata.retailer : null,
        title: typeof metadata.title === "string" ? metadata.title : null
    };
};

const fetchProductData = async (targetUrl: URL, locales: string[]) => {
    try {
        const response = await gotScraping({
            url: targetUrl,
            proxyUrl: determineProxy(targetUrl),
            headerGeneratorOptions: {
                devices: ["desktop"],
                locales: locales.length > 0 ? locales : ["en-US", "en"]
            }
        });

        return await scraper({ html: response.body, url: response.url });
    } catch (err) {
        throw new ProductScrapeError(`Unable to fetch product data from ${targetUrl}: ${String(err)}`, "network");
    }
};

export const scrapeProductData = async (targetUrl: URL, locales: string[] = []) => {
    let metadata = await fetchProductData(targetUrl, locales);
    if (isCaptchaResponse(metadata) && metadata.url) {
        metadata = await fetchProductData(new URL(metadata.url), locales);
    }

    if (isCaptchaResponse(metadata)) {
        throw new ProductScrapeError("Captcha challenge while scraping product", "captcha");
    }

    if (metadata.url === metadata.image) {
        metadata.url = targetUrl.toString();
    }

    return normalizeProductData(metadata);
};

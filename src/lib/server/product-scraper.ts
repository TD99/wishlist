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

type BambuLabPrice = { price: number; currency: string | null };

/**
 * Bambu Lab's storefront renders a selected variant's price in its serialized
 * storefront state instead of the usual product/offer metadata. The `id`
 * query parameter is that variant id and Shopify stores prices as minor units.
 */
const getBambuLabPrice = (html: string, url: URL): BambuLabPrice | null => {
    if (!url.hostname.endsWith("store.bambulab.com")) return null;

    const variantId = url.searchParams.get("id") || url.searchParams.get("variant");
    const source = html.replaceAll('\\"', '"');
    const variantIndex = variantId ? source.indexOf(variantId) : -1;
    const objectStart = variantIndex >= 0 ? source.lastIndexOf("{", variantIndex) : -1;
    const objectEnd = variantIndex >= 0 ? source.indexOf("}", variantIndex) : -1;
    const variantObject = objectStart >= 0 && objectEnd > variantIndex ? source.slice(objectStart, objectEnd + 1) : "";
    const context =
        variantObject ||
        (variantIndex >= 0 ? source.slice(Math.max(0, variantIndex - 2500), variantIndex + 2500) : source);
    const priceMatch = context.match(/"(?:price|sale_price|final_price)"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)"?/i);
    if (!priceMatch) return null;

    const rawPrice = priceMatch[1].replace(",", ".");
    const numericPrice = Number.parseFloat(rawPrice);
    if (!Number.isFinite(numericPrice)) return null;
    const price = rawPrice.includes(".") ? numericPrice : numericPrice / 100;
    const currencyMatch = context.match(/"(?:currency|currency_code|currencyCode)"\s*:\s*"([A-Z]{3})"/i);
    const documentCurrencyMatch = source.match(/"(?:currency|currency_code|currencyCode)"\s*:\s*"([A-Z]{3})"/i);
    return { price, currency: currencyMatch?.[1]?.toUpperCase() || documentCurrencyMatch?.[1]?.toUpperCase() || null };
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

        return {
            metadata: await scraper({ html: response.body, url: response.url }),
            html: response.body,
            url: response.url
        };
    } catch (err) {
        throw new ProductScrapeError(`Unable to fetch product data from ${targetUrl}: ${String(err)}`, "network");
    }
};

export const scrapeProductData = async (targetUrl: URL, locales: string[] = []) => {
    let response = await fetchProductData(targetUrl, locales);
    let metadata = response.metadata;
    if (isCaptchaResponse(metadata) && metadata.url) {
        response = await fetchProductData(new URL(metadata.url), locales);
        metadata = response.metadata;
    }

    if (isCaptchaResponse(metadata)) {
        throw new ProductScrapeError("Captcha challenge while scraping product", "captcha");
    }

    if (metadata.url === metadata.image) {
        metadata.url = targetUrl.toString();
    }

    const product = normalizeProductData(metadata);
    const bambuLabPrice = getBambuLabPrice(response.html, new URL(response.url));
    return {
        ...product,
        price: product.price ?? bambuLabPrice?.price ?? null,
        currency: product.currency ?? bambuLabPrice?.currency ?? null
    };
};

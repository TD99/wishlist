import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { parseAcceptLanguageHeader } from "$lib/i18n";
import { getFormatter } from "$lib/server/i18n";
import { requireLoginOrError } from "$lib/server/auth";
import { ProductScrapeError, scrapeProductData } from "$lib/server/product-scraper";

const getUrlOrError = async (url: string) => {
    const $t = await getFormatter();

    try {
        return new URL(url);
    } catch {
        error(400, $t("errors.valid-url-not-provided"));
    }
};

export const GET: RequestHandler = async ({ request, url }) => {
    await requireLoginOrError();
    const $t = await getFormatter();
    const encodedUrl = url.searchParams.get("url");
    const acceptLanguage = request.headers?.get("accept-language");
    const locales = parseAcceptLanguageHeader(acceptLanguage);

    if (encodedUrl) {
        const targetUrl = await getUrlOrError(decodeURI(encodedUrl));
        try {
            const productData = await scrapeProductData(targetUrl, locales);
            return new Response(JSON.stringify(productData));
        } catch (err) {
            if (err instanceof ProductScrapeError && err.code === "captcha") {
                error(424, $t("errors.product-information-not-available"));
            }
            error(500, $t("errors.unable-to-find-product-information"));
        }
    } else {
        error(400, $t("errors.must-specify-url-in-query-parameters"));
    }
};

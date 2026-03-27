import { client } from "$lib/server/prisma";
import { logger } from "$lib/server/logger";
import { ProductScrapeError, scrapeProductData } from "$lib/server/product-scraper";

const MIN_POLL_INTERVAL_MINUTES = 60;
const DEFAULT_POLL_INTERVAL_MINUTES = 12 * 60;
const RETRY_INTERVAL_MINUTES = 60;
const DUE_POLL_BATCH_SIZE = 10;
const MAX_CYCLES_PER_TICK = 3;
const WORKER_INTERVAL_MS = 15 * 60 * 1000;

const globalState = globalThis as typeof globalThis & {
    __wishlistPricePollerState?: {
        started: boolean;
        running: boolean;
        timer: ReturnType<typeof setInterval> | null;
    };
};

const normalizePollIntervalMinutes = (intervalMinutes?: number | null) => {
    if (!intervalMinutes || Number.isNaN(intervalMinutes)) {
        return DEFAULT_POLL_INTERVAL_MINUTES;
    }

    return Math.max(MIN_POLL_INTERVAL_MINUTES, Math.round(intervalMinutes));
};

const getFractionDigits = (currency: string) => {
    try {
        return (
            new Intl.NumberFormat("en-US", {
                style: "currency",
                currency
            }).resolvedOptions().maximumFractionDigits || 2
        );
    } catch {
        return 2;
    }
};

const toMinorUnits = (value: number, currency: string) => {
    const fractionDigits = getFractionDigits(currency);
    return Math.round(value * Math.pow(10, fractionDigits));
};

const getNowPlusMinutes = (minutes: number) => {
    return new Date(Date.now() + minutes * 60 * 1000);
};

const getEffectiveIntervalMinutes = (listIntervals: number[]) => {
    if (listIntervals.length === 0) {
        return DEFAULT_POLL_INTERVAL_MINUTES;
    }

    return normalizePollIntervalMinutes(Math.min(...listIntervals));
};

const getDueItems = async (now: Date) => {
    return await client.item.findMany({
        select: {
            id: true,
            url: true,
            itemPriceId: true,
            itemPrice: {
                select: {
                    currency: true
                }
            },
            lists: {
                select: {
                    list: {
                        select: {
                            pricePollingEnabled: true,
                            pricePollIntervalMinutes: true
                        }
                    }
                }
            }
        },
        where: {
            pricePollingEnabled: true,
            url: {
                not: null
            },
            lists: {
                some: {
                    list: {
                        pricePollingEnabled: true
                    }
                }
            },
            OR: [
                {
                    nextPricePollAt: null
                },
                {
                    nextPricePollAt: {
                        lte: now
                    }
                }
            ]
        },
        orderBy: [
            {
                nextPricePollAt: "asc"
            },
            {
                id: "asc"
            }
        ],
        take: DUE_POLL_BATCH_SIZE
    });
};

const pollSingleItem = async (item: {
    id: number;
    url: string | null;
    itemPriceId: string | null;
    itemPrice: { currency: string } | null;
    lists: { list: { pricePollingEnabled: boolean; pricePollIntervalMinutes: number } }[];
}) => {
    if (!item.url) {
        await client.item.update({
            where: {
                id: item.id
            },
            data: {
                nextPricePollAt: null
            }
        });
        return;
    }

    const enabledListIntervals = item.lists
        .filter(({ list }) => list.pricePollingEnabled)
        .map(({ list }) => list.pricePollIntervalMinutes);
    if (enabledListIntervals.length === 0) {
        await client.item.update({
            where: {
                id: item.id
            },
            data: {
                nextPricePollAt: null
            }
        });
        return;
    }

    const intervalMinutes = getEffectiveIntervalMinutes(enabledListIntervals);
    const now = new Date();
    const nextPollAt = getNowPlusMinutes(intervalMinutes);

    try {
        const productData = await scrapeProductData(new URL(item.url), ["en-US", "en"]);
        if (productData.price === null) {
            await client.item.update({
                where: {
                    id: item.id
                },
                data: {
                    nextPricePollAt: nextPollAt
                }
            });
            return;
        }

        const currency = productData.currency || item.itemPrice?.currency || "USD";
        const value = toMinorUnits(productData.price, currency);
        const updatedUrl = productData.url || item.url;

        await client.$transaction(async (tx) => {
            const currentItem = await tx.item.findUnique({
                select: {
                    id: true,
                    itemPriceId: true
                },
                where: {
                    id: item.id
                }
            });
            if (!currentItem) {
                return;
            }

            let itemPriceId = currentItem.itemPriceId;
            if (itemPriceId) {
                await tx.itemPrice.update({
                    where: {
                        id: itemPriceId
                    },
                    data: {
                        value,
                        currency
                    }
                });
            } else {
                const itemPrice = await tx.itemPrice.create({
                    data: {
                        value,
                        currency
                    }
                });
                itemPriceId = itemPrice.id;
            }

            await tx.itemPriceHistory.create({
                data: {
                    itemId: currentItem.id,
                    value,
                    currency
                }
            });

            await tx.item.update({
                where: {
                    id: currentItem.id
                },
                data: {
                    itemPriceId,
                    url: updatedUrl,
                    lastPricePolledAt: now,
                    nextPricePollAt: nextPollAt
                }
            });
        });
    } catch (err) {
        const nextRetryAt = getNowPlusMinutes(RETRY_INTERVAL_MINUTES);
        await client.item.update({
            where: {
                id: item.id
            },
            data: {
                nextPricePollAt: nextRetryAt
            }
        });

        if (err instanceof ProductScrapeError) {
            logger.warn(
                { itemId: item.id, code: err.code, err: err.message },
                "Unable to poll item price from product scraper"
            );
            return;
        }

        logger.error({ itemId: item.id, err }, "Unexpected error while polling item price");
    }
};

export const runDuePricePolling = async () => {
    for (let cycle = 0; cycle < MAX_CYCLES_PER_TICK; cycle++) {
        const dueItems = await getDueItems(new Date());
        if (dueItems.length === 0) {
            return;
        }

        for (const item of dueItems) {
            await pollSingleItem(item);
        }
    }
};

export const ensurePricePollingWorker = () => {
    const existingState = globalState.__wishlistPricePollerState;
    if (existingState?.started) {
        return;
    }

    globalState.__wishlistPricePollerState = {
        started: true,
        running: false,
        timer: null
    };

    const runTick = async () => {
        const state = globalState.__wishlistPricePollerState;
        if (!state || state.running) {
            return;
        }

        state.running = true;
        try {
            await runDuePricePolling();
        } catch (err) {
            logger.error({ err }, "Unhandled error while running price polling worker");
        } finally {
            state.running = false;
        }
    };

    void runTick();
    const timer = setInterval(() => {
        void runTick();
    }, WORKER_INTERVAL_MS);
    timer.unref?.();

    globalState.__wishlistPricePollerState.timer = timer;
};

export const schedulePricePollNow = async (itemId: number) => {
    await client.item.updateMany({
        where: {
            id: itemId,
            pricePollingEnabled: true,
            url: {
                not: null
            }
        },
        data: {
            nextPricePollAt: new Date()
        }
    });
};

export const alignListPollingSchedule = async (
    listId: string,
    pollIntervalMinutes: number,
    listPollingEnabled: boolean
) => {
    if (!listPollingEnabled) {
        await client.item.updateMany({
            where: {
                pricePollingEnabled: true,
                lists: {
                    some: {
                        listId
                    }
                },
                NOT: {
                    lists: {
                        some: {
                            list: {
                                pricePollingEnabled: true
                            }
                        }
                    }
                }
            },
            data: {
                nextPricePollAt: null
            }
        });
        return;
    }

    const normalizedIntervalMinutes = normalizePollIntervalMinutes(pollIntervalMinutes);
    const nextPollThreshold = getNowPlusMinutes(normalizedIntervalMinutes);

    await client.item.updateMany({
        where: {
            pricePollingEnabled: true,
            url: {
                not: null
            },
            lists: {
                some: {
                    listId
                }
            },
            OR: [
                {
                    nextPricePollAt: null
                },
                {
                    nextPricePollAt: {
                        gt: nextPollThreshold
                    }
                }
            ]
        },
        data: {
            nextPricePollAt: nextPollThreshold
        }
    });
};

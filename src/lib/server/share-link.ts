import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { randomUUID, timingSafeEqual } from "node:crypto";
import generateToken, { hashToken } from "./token";
import { client } from "./prisma";

export const shareTokenQueryParam = "share";
export const shareTokenHeader = "x-wishlist-share-token";
export const shareAccessorCookieName = "wishlist_share_accessor";

const MAX_SHARE_TOKEN_LENGTH = 512;
const MAX_ACCESSOR_ID_LENGTH = 128;
const shareTokenDelimiter = ".";
const origin = new URL(env.ORIGIN || "http://localhost:3280");

interface ShareableList {
    id: string;
    public: boolean;
    publicShareTokenHash: string | null;
}

interface ShareLinkToken {
    shareLinkId: string;
    secret: string;
}

const normalizeToken = (token: string | null) => {
    if (!token) {
        return null;
    }

    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_SHARE_TOKEN_LENGTH) {
        return null;
    }

    return trimmed;
};

const parseShareToken = (token: string | null): ShareLinkToken | null => {
    if (!token) {
        return null;
    }

    const [shareLinkId, secret, ...rest] = token.split(shareTokenDelimiter);
    if (!shareLinkId || !secret || rest.length > 0) {
        return null;
    }

    return { shareLinkId, secret };
};

const hashesMatch = (a: string, b: string) => {
    if (a.length !== b.length) {
        return false;
    }

    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export const getShareTokenFromUrl = (url: URL) => {
    return normalizeToken(url.searchParams.get(shareTokenQueryParam));
};

export const getShareTokenFromRequest = (request: Request, url: URL) => {
    const fromHeader = normalizeToken(request.headers.get(shareTokenHeader));
    if (fromHeader) {
        return fromHeader;
    }

    return getShareTokenFromUrl(url);
};

export const validateListShareToken = async (list: ShareableList, token: string | null) => {
    if (!list.public || !token) {
        return { valid: false, shareLinkId: undefined as string | undefined };
    }

    const parsed = parseShareToken(token);
    if (parsed) {
        const shareLink = await client.listShareLink.findUnique({
            select: {
                id: true,
                listId: true,
                tokenHash: true
            },
            where: {
                id: parsed.shareLinkId
            }
        });
        if (!shareLink || shareLink.listId !== list.id) {
            return { valid: false, shareLinkId: undefined as string | undefined };
        }

        if (!hashesMatch(hashToken(parsed.secret), shareLink.tokenHash)) {
            return { valid: false, shareLinkId: undefined as string | undefined };
        }

        return { valid: true, shareLinkId: shareLink.id };
    }

    // fallback support for legacy one-link token format
    if (list.publicShareTokenHash && hashesMatch(hashToken(token), list.publicShareTokenHash)) {
        return { valid: true, shareLinkId: undefined as string | undefined };
    }

    return { valid: false, shareLinkId: undefined as string | undefined };
};

export const createListShareToken = async (listId: string) => {
    const shareLinkId = randomUUID();
    const secret = await generateToken();
    const tokenHash = hashToken(secret);
    const tokenHint = secret.slice(0, 8);

    const shareLink = await client.$transaction(async (tx) => {
        await tx.list.update({
            where: {
                id: listId
            },
            data: {
                public: true
            }
        });

        return await tx.listShareLink.create({
            data: {
                id: shareLinkId,
                listId,
                tokenHash,
                tokenHint
            },
            select: {
                id: true,
                tokenHint: true,
                createdAt: true
            }
        });
    });

    return {
        shareLink,
        token: `${shareLinkId}${shareTokenDelimiter}${secret}`
    };
};

export const deleteAllListShareLinks = async (listId: string) => {
    await client.listShareLink.deleteMany({
        where: {
            listId
        }
    });
};

export const getListShareLinks = async (listId: string) => {
    return await client.listShareLink.findMany({
        select: {
            id: true,
            tokenHint: true,
            createdAt: true,
            _count: {
                select: {
                    accessors: true
                }
            }
        },
        where: {
            listId
        },
        orderBy: {
            createdAt: "desc"
        }
    });
};

export const deleteListShareLink = async (listId: string, shareLinkId: string) => {
    return await client.listShareLink.deleteMany({
        where: {
            id: shareLinkId,
            listId
        }
    });
};

export const trackShareLinkAccess = async (cookies: Cookies, shareLinkId: string | undefined) => {
    if (!shareLinkId) {
        return;
    }

    const cookieValue = cookies.get(shareAccessorCookieName);
    const accessorId =
        cookieValue && cookieValue.length <= MAX_ACCESSOR_ID_LENGTH ? cookieValue : randomUUID().replaceAll("-", "");

    cookies.set(shareAccessorCookieName, accessorId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        secure: !dev && origin.protocol === "https:"
    });

    await client.listShareLinkAccessor.upsert({
        where: {
            shareLinkId_accessorId: {
                shareLinkId,
                accessorId
            }
        },
        create: {
            shareLinkId,
            accessorId
        },
        update: {
            lastAccessedAt: new Date()
        }
    });
};

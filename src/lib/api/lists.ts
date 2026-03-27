import type { listItemsUpdateSchema } from "$lib/server/validations";
import { z } from "zod";

export interface ShareLinkSummary {
    id: string;
    tokenHint: string;
    createdAt: string | Date;
    uniqueAccessorCount: number;
}

export class ListAPI {
    private listId: string;
    private shareToken?: string;

    constructor(listId: string, options?: { shareToken?: string }) {
        this.listId = listId;
        this.shareToken = options?.shareToken;
    }

    _makeRequest = async (method: string, path: string, data?: Record<string, any>) => {
        const options: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                accept: "application/json"
            }
        };
        if (this.shareToken) {
            options.headers = {
                ...options.headers,
                "x-wishlist-share-token": this.shareToken
            };
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        const url = `/api/lists/${this.listId}${path}`;
        return await fetch(url, options);
    };

    makePublic = async () => {
        return await this._makeRequest("PATCH", "/", { public: true });
    };

    generateShareLink = async () => {
        return await this._makeRequest("POST", "/share-links");
    };

    updateItems = async (data: z.infer<typeof listItemsUpdateSchema>[]) => {
        return await this._makeRequest("PATCH", "/items", data);
    };

    getShareLinks = async () => {
        return await this._makeRequest("GET", "/share-links");
    };

    deleteShareLink = async (shareLinkId: string) => {
        return await this._makeRequest("DELETE", `/share-links/${shareLinkId}`);
    };
}

export class ListItemAPI {
    private listId: string;
    private itemId: number;
    private shareToken?: string;

    constructor(listId: string, itemId: number, options?: { shareToken?: string }) {
        this.listId = listId;
        this.itemId = itemId;
        this.shareToken = options?.shareToken;
    }

    _makeRequest = async (method: string, path: string = "/", data?: Record<string, any>) => {
        const options: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                accept: "application/json"
            }
        };
        if (this.shareToken) {
            options.headers = {
                ...options.headers,
                "x-wishlist-share-token": this.shareToken
            };
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        const url = `/api/lists/${this.listId}/items/${this.itemId}${path}`;
        return await fetch(url, options);
    };

    delete = async () => {
        return await this._makeRequest("DELETE");
    };

    approve = async () => {
        return await this._makeRequest("PATCH", "/", { approved: true });
    };

    deny = async () => {
        return await this._makeRequest("DELETE");
    };

    claim = async (claimedById: string, quantity: number) => {
        return await this._makeRequest("PUT", "/claims", { claimedById, quantity });
    };

    claimPublic = async (publicClaimedById: string, quantity: number) => {
        return await this._makeRequest("PUT", "/claims", { publicClaimedById, quantity });
    };

    getPriceHistory = async () => {
        return await this._makeRequest("GET", "/price-history");
    };
}

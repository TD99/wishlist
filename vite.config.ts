import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";
import { exec } from "child_process";
import { env } from "process";
import { promisify } from "util";
import type { UserConfig } from "vite";

// Get current tag/commit and last commit date from git
const pexec = promisify(exec);
const [version, sha] = (
    await Promise.all([
        env.VERSION ?? pexec("git describe --tags || git rev-parse --short HEAD").then((v) => v.stdout.trim()),
        env.SHA ?? pexec("git rev-parse --short HEAD").then((v) => v.stdout.trim())
    ])
).map((v) => JSON.stringify(v));

const config: UserConfig = {
    plugins: [
        tailwindcss(),
        sveltekit(),
        SvelteKitPWA({
            registerType: "autoUpdate",
            manifest: {
                name: "Wishlist",
                short_name: "Wishlist",
                description: "Christmas wishlist you can share with the whole family.",
                theme_color: "#423654",
                icons: [
                    {
                        src: "/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png"
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png"
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                        purpose: "any maskable"
                    }
                ],
                share_target: {
                    action: "/items/import",
                    method: "GET",
                    params: {
                        url: "url",
                        text: "text",
                        title: "title"
                    }
                }
            },
            workbox: {
                navigateFallback: "/",
                runtimeCaching: [
                    {
                        urlPattern: /\/_app\/immutable\/.+/,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "wishlist-app-assets",
                            cacheableResponse: {
                                statuses: [0, 200]
                            },
                            expiration: {
                                maxEntries: 300,
                                maxAgeSeconds: 60 * 60 * 24 * 365
                            }
                        }
                    },
                    {
                        urlPattern: /\/__data\.json(?:\?.*)?$/,
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "wishlist-route-data",
                            networkTimeoutSeconds: 3,
                            cacheableResponse: {
                                statuses: [0, 200]
                            },
                            expiration: {
                                maxEntries: 500,
                                maxAgeSeconds: 60 * 60 * 24 * 365
                            }
                        }
                    },
                    {
                        urlPattern: /\/(?!api\/|_app\/|.*\.[a-zA-Z0-9]+$).*/,
                        method: "GET",
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "wishlist-pages",
                            networkTimeoutSeconds: 3,
                            cacheableResponse: {
                                statuses: [0, 200]
                            },
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 60 * 60 * 24 * 365
                            }
                        }
                    },
                    {
                        urlPattern: /\/api\/.+/,
                        method: "GET",
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "wishlist-api-get",
                            networkTimeoutSeconds: 3,
                            cacheableResponse: {
                                statuses: [0, 200]
                            },
                            expiration: {
                                maxEntries: 500,
                                maxAgeSeconds: 60 * 60 * 24 * 365
                            }
                        }
                    },
                    {
                        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
                        handler: "StaleWhileRevalidate",
                        options: {
                            cacheName: "wishlist-images",
                            cacheableResponse: {
                                statuses: [0, 200]
                            },
                            expiration: {
                                maxEntries: 300,
                                maxAgeSeconds: 60 * 60 * 24 * 365
                            }
                        }
                    }
                ]
            },
            devOptions: {
                enabled: true,
                type: "module",
                navigateFallback: "/"
            }
        })
    ],
    server: {
        fs: {
            // Allow serving files from one level up to the project root
            allow: ["./static/"]
        }
    },
    define: {
        __VERSION__: version,
        __COMMIT_SHA__: sha,
        __LASTMOD__: Date.now()
    },
    build: {
        rollupOptions: {
            external: ["sharp"]
        }
    }
};

export default config;

<script lang="ts">
    import "../app.css";

    import { afterNavigate, beforeNavigate, preloadData } from "$app/navigation";
    import { page } from "$app/state";
    import { pwaInfo } from "virtual:pwa-info";
    import { readable } from "svelte/store";

    import NavBar from "$lib/components/navigation/NavBar.svelte";
    import NavigationLoadingBar from "$lib/components/navigation/NavigationLoadingBar.svelte";
    import type { LayoutProps } from "./$types";
    import { onMount } from "svelte";
    import BottomTabs from "$lib/components/navigation/BottomTabs.svelte";
    import { isInstalled } from "$lib/stores/is-installed";
    import PullToRefresh from "pulltorefreshjs";
    import { navItems } from "$lib/components/navigation/navigation";
    import { setFormatter, setLocale } from "$lib/i18n";
    import Toaster from "$lib/components/toaster/Toaster.svelte";

    const { data, children }: LayoutProps = $props();

    interface DeferredInstallPromptEvent extends Event {
        prompt: () => Promise<void>;
        userChoice: Promise<{
            outcome: "accepted" | "dismissed";
            platform: string;
        }>;
    }

    let showNavigationLoadingBar = $state(false);
    let documentTitle: string | undefined = $state();
    let disabled = $state(false);
    const fallbackFormatter = readable((id: string) => id);

    const titleDisabledUrls = [
        "/login",
        "/signup",
        /^\/$/,
        "/forgot-password",
        "/reset-password",
        "/group-error",
        /\/setup-wizard\/?.*/
    ];

    setFormatter(data?.t ?? fallbackFormatter);
    setLocale(data?.locale ?? "en");

    beforeNavigate(() => {
        showNavigationLoadingBar = true;
    });

    afterNavigate((params) => {
        showNavigationLoadingBar = false;
        documentTitle = document?.title;
        disabled = titleDisabledUrls.find((url) => page.url.pathname.match(url)) !== undefined;
        if (params.type !== "popstate" && params.to?.url.pathname !== params.from?.url.pathname) {
            const elemPage = document.querySelector("#page");
            if (elemPage) elemPage.scrollTop = 0;
        }
        if (navigator.onLine) {
            void warmOfflineCache();
        }
    });

    let shouldPullToRefresh = $state(true);
    let deferredInstallPrompt = $state<DeferredInstallPromptEvent | null>(null);
    let showManualInstallPrompt = $state(false);

    const toPathWithSearch = (value: string) => {
        const url = new URL(value, window.location.origin);
        return `${url.pathname}${url.search}`;
    };

    const warmedRequests = new Set<string>();

    const warmRequest = async (pathWithSearch: string) => {
        if (warmedRequests.has(pathWithSearch)) {
            return;
        }

        const response = await fetch(pathWithSearch, {
            credentials: "include"
        });
        if (response.ok) {
            warmedRequests.add(pathWithSearch);
        }
    };

    const warmOfflineCache = async () => {
        if (!navigator.onLine) {
            return;
        }

        const paths = new Set<string>();
        paths.add("/");
        paths.add(`${window.location.pathname}${window.location.search}`);
        for (const navItem of navItems) {
            paths.add(toPathWithSearch(navItem.href(data?.user ?? undefined)));
        }

        const requests: Promise<void>[] = [];
        for (const routePath of paths) {
            requests.push(warmRequest(routePath));
            requests.push(preloadData(routePath).then(() => undefined));
        }

        await Promise.allSettled(requests);
    };

    const promptInstall = async () => {
        if (!deferredInstallPrompt) {
            return;
        }

        await deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === "accepted") {
            deferredInstallPrompt = null;
        }
    };

    onMount(() => {
        let installPromptFallbackTimeout: number | undefined;
        const standalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
        if (standalone) {
            $isInstalled = true;
        }

        if (!standalone) {
            const isIos = /iPad|iPhone|iPod/i.test(window.navigator.userAgent);
            if (isIos) {
                showManualInstallPrompt = true;
            } else {
                installPromptFallbackTimeout = window.setTimeout(() => {
                    if (!$isInstalled && !deferredInstallPrompt) {
                        showManualInstallPrompt = true;
                    }
                }, 1500);
            }
        }

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            deferredInstallPrompt = event as DeferredInstallPromptEvent;
            showManualInstallPrompt = false;
        };

        const handleAppInstalled = () => {
            $isInstalled = true;
            deferredInstallPrompt = null;
            showManualInstallPrompt = false;
        };

        const handleOnline = () => {
            void warmOfflineCache();
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleAppInstalled);
        window.addEventListener("online", handleOnline);

        if ("serviceWorker" in navigator) {
            void navigator.serviceWorker.ready.then(() => warmOfflineCache());
        }

        if (standalone) {
            const handleTouchStart = (ev: Event) => {
                let el = ev.target as HTMLElement | null;
                while (el && el.parentNode && el !== document.body) {
                    if (el.scrollTop > 0) {
                        shouldPullToRefresh = false;
                    }
                    if (el.getAttribute("role") === "dialog") {
                        shouldPullToRefresh = false;
                        break;
                    }
                    el = el.parentNode as HTMLElement;
                }
            };
            const handleTouchEnd = () => {
                shouldPullToRefresh = true;
            };

            // don't PTR inside of dialogs
            document.body.addEventListener("touchstart", handleTouchStart, { passive: true });
            document.body.addEventListener("touchend", handleTouchEnd, { passive: true });

            const ptr = PullToRefresh.init({
                mainElement: "#main",
                distThreshold: 70,
                resistanceFunction: (t) => Math.min(1, t / 4.5),
                getStyles: () => `
.__PREFIX__ptr {
  box-shadow: inset 0 -3px 5px color-mix(in oklab, var(--color-surface-950-50) 12%, transparent);
  pointer-events: none;
  font-size: 0.85em;
  font-weight: bold;
  top: 0;
  height: 0;
  transition: height 0.3s, min-height 0.3s;
  text-align: center;
  width: 100%;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  align-content: stretch;
}
.__PREFIX__box { padding: 10px; flex-basis: 100%; }
.__PREFIX__pull { transition: none; }
.__PREFIX__text, .__PREFIX__icon {
  color: var(--color-surface-900);
}
:root[data-mode="dark"] .__PREFIX__text,
:root[data-mode="dark"] .__PREFIX__icon {
  color: var(--color-surface-50);
}
.__PREFIX__icon { transition: transform .3s; }
.__PREFIX__top { touch-action: pan-x pan-down pinch-zoom; }
.__PREFIX__release .__PREFIX__icon { transform: rotate(180deg); }
`,
                onRefresh() {
                    if (!navigator.onLine) {
                        return Promise.resolve();
                    }
                    window.location.reload();
                },
                shouldPullToRefresh: () => !window.scrollY && shouldPullToRefresh
            });
            return () => {
                if (installPromptFallbackTimeout !== undefined) {
                    window.clearTimeout(installPromptFallbackTimeout);
                }
                window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
                window.removeEventListener("appinstalled", handleAppInstalled);
                window.removeEventListener("online", handleOnline);
                document.body.removeEventListener("touchstart", handleTouchStart);
                document.body.removeEventListener("touchend", handleTouchEnd);
                ptr.destroy();
            };
        }

        return () => {
            if (installPromptFallbackTimeout !== undefined) {
                window.clearTimeout(installPromptFallbackTimeout);
            }
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleAppInstalled);
            window.removeEventListener("online", handleOnline);
        };
    });

    onMount(async () => {
        try {
            const { registerSW } = await import("virtual:pwa-register");
            registerSW({
                immediate: true,
                onRegistered(r) {
                    console.log(`SW Registered: ${r}`);
                },
                onRegisterError(error) {
                    console.log("SW registration error", error);
                }
            });
        } catch (error) {
            console.log("SW registration unavailable", error);
        }
    });

    const webManifestLink = $derived(pwaInfo?.webManifest.linkTag ?? '<link rel="manifest" href="/manifest.webmanifest">');

    let footerHeight: number | undefined = $state();
    let toasterYShift: number | undefined = $derived(footerHeight && footerHeight + 12);
</script>

<div class="min-h-screen">
    <header class="sticky top-0 z-15 print:hidden">
        {#if showNavigationLoadingBar}
            <NavigationLoadingBar />
        {/if}
        <NavBar groups={data?.groups ?? null} isProxyUser={data?.isProxyUser ?? false} {navItems} user={data?.user ?? null} />
    </header>

    <main id="main" class="h-full min-h-screen px-4 py-4 md:px-12 lg:px-32 xl:px-56">
        {#if !disabled && documentTitle}
            <h1 class="h1 pb-2 md:pb-4">{documentTitle}</h1>
        {/if}
        {@render children?.()}
    </main>

    <footer class="sticky bottom-0 z-10 print:hidden" bind:clientHeight={footerHeight}>
        <BottomTabs {navItems} user={data?.user ?? null} />
    </footer>
</div>

{#if !$isInstalled && (deferredInstallPrompt || showManualInstallPrompt)}
    <aside class="rounded-container bg-surface-100-900 border-surface-500 fixed right-4 bottom-28 z-20 max-w-72 border p-3 shadow-xl md:bottom-32">
        <p class="font-semibold">Install Wishlist</p>
        {#if deferredInstallPrompt}
            <p class="subtext pt-1">Use the app offline and keep your data available without a connection.</p>
        {:else}
            <p class="subtext pt-1">Open your browser menu and choose "Install app" or "Add to Home Screen".</p>
        {/if}
        <div class="flex justify-end gap-2 pt-3">
            <button
                class="btn btn-xs"
                onclick={() => {
                    deferredInstallPrompt = null;
                    showManualInstallPrompt = false;
                }}
                type="button">Later</button
            >
            {#if deferredInstallPrompt}
                <button class="preset-filled btn btn-xs" onclick={promptInstall} type="button">Install</button>
            {/if}
        </div>
    </aside>
{/if}

<Toaster yShift={toasterYShift} />

<svelte:head>
    {@html webManifestLink}
</svelte:head>

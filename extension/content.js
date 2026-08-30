// Only run the script if we are on the main YouTube downloader page (not facebook, etc)
// And wait a bit to ensure Cloudflare isn't in the middle of refreshing
setTimeout(() => {
    if (window.location.pathname.includes('facebook') || window.location.pathname.includes('tiktok')) {
        console.log("On wrong page, attempting to redirect back to youtube downloader");
        window.location.href = "https://vd6s.net/en5/";
        return;
    }

    // Notify background script that we are ready to receive a URL
    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
}, 1000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROCESS_URL') {
        const url = message.payload;
        processUrl(url);
    }
});

async function processUrl(url) {
    try {
        // 1. Find the input box and paste the URL
        const input = await waitForElement('#txt-url, input[placeholder*="search"], input[name="query"]', 10000);
        if (!input) {
            throw new Error("Input box not found");
        }

        // Simulate typing/pasting
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for exactly 6 seconds after pasting link as requested
        await sleep(6000);

        // Check if results container appeared automatically
        let optionsContainer = document.querySelector('.video-formats, .download-options, table, .result, #result');

        // If not, try clicking the search button
        if (!optionsContainer) {
            const searchBtn = document.querySelector('button[type="submit"]') ||
                              document.querySelector('.btn-search') ||
                              document.querySelector('#btn-submit');
            if (searchBtn) {
                searchBtn.click();
            }
        }

        // 2. Wait for the download options to appear (increased timeout to 60s for Cloudflare)
        optionsContainer = await waitForElement('.video-formats, .download-options, table, .result, #result', 60000);

        if (!optionsContainer) {
            throw new Error("Options container not found after pasting link");
        }

        // Give it a moment to fully render the options
        await sleep(2000);

        // 3. Find the highest quality video option
        // Find rows or buttons that represent MP4 or video formats
        const downloadButtons = Array.from(document.querySelectorAll('a, button')).filter(el => {
            const text = el.textContent.toLowerCase();
            return text.includes('download') && el.offsetParent !== null; // visible
        });

        if (downloadButtons.length === 0) {
            throw new Error("No download buttons found in the results");
        }

        // Try to identify the highest quality video row
        let bestBtn = null;
        let bestRes = -1;

        // Helper to find resolution in text (e.g., 1080p, 720p)
        const getRes = (text) => {
            const match = text.match(/(\d+)p/);
            return match ? parseInt(match[1]) : 0;
        };

        // Sometimes the resolution is in the same row/container as the button
        // So we iterate through rows or parent elements
        const rows = document.querySelectorAll('tr, .row, li');
        for (const row of rows) {
            const text = row.textContent.toLowerCase();
            if (text.includes('mp4') || text.includes('video')) { // We want video
                const res = getRes(text);
                const btn = row.querySelector('a, button');
                if (btn && btn.textContent.toLowerCase().includes('download')) {
                    if (res > bestRes) {
                        bestRes = res;
                        bestBtn = btn;
                    }
                }
            }
        }

        // If we didn't find by row, try just finding the first download button
        if (!bestBtn) {
            bestBtn = downloadButtons[0];
        }

        // Click the initial download button for the chosen quality
        bestBtn.click();

        // 4. Wait for the popup modal to appear and click final "Download"
        // The modal usually has "downloading this and that" and a final download button
        // Also has a cross button on upper right.
        const finalDownloadBtn = await waitForElement(
            'a[href*="download"], button.btn-success, .modal-content a, .modal-content button',
            15000,
            (el) => {
                const text = el.textContent.toLowerCase();
                // Filter out rate us buttons and close buttons
                return text.includes('download') && !text.includes('rate') && el.offsetParent !== null;
            }
        );

        if (!finalDownloadBtn) {
             throw new Error("Final download modal button not found");
        }

        // Give modal a second to fully animate in
        await sleep(1000);

        // Click the final download button
        finalDownloadBtn.click();

        // The background script will detect the actual download starting via chrome.downloads
        // We don't need to report success immediately, but we can say we clicked it.

    } catch (error) {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_ERROR', payload: { error: error.message } });
    }
}

// Utility to wait for an element to appear in the DOM
function waitForElement(selector, timeout, condition = null) {
    return new Promise((resolve) => {
        const checkElement = () => {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                if (el.offsetParent !== null) { // Check if visible
                    if (!condition || condition(el)) {
                        return el;
                    }
                }
            }
            return null;
        };

        const initialCheck = checkElement();
        if (initialCheck) {
            return resolve(initialCheck);
        }

        const observer = new MutationObserver((mutations, obs) => {
            const el = checkElement();
            if (el) {
                obs.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

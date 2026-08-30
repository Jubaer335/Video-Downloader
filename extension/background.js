let downloadQueue = [];
let isProcessing = false;
let currentTabId = null;
let currentDownloadId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_DOWNLOADS') {
    // Get full queue from popup (which might contain pending, complete, failed)
    // We only care about processing the pending ones
    const newQueue = message.payload;

    // Add only new pending items to our background queue
    newQueue.forEach(item => {
        if (item.status === 'pending' && !downloadQueue.some(qItem => qItem.url === item.url)) {
            downloadQueue.push(item);
        }
    });

    if (!isProcessing) {
      processQueue();
    }
    sendResponse({ status: 'started' });
  } else if (message.type === 'CONTENT_SCRIPT_READY') {
      // Content script is ready, send the current URL to process
      if (isProcessing && downloadQueue.length > 0) {
          const currentItem = downloadQueue.find(item => item.status === 'pending');
          if (currentItem) {
             chrome.tabs.sendMessage(currentTabId, { type: 'PROCESS_URL', payload: currentItem.url });
          }
      }
  } else if (message.type === 'DOWNLOAD_ERROR') {
      // Content script failed to process the URL
      console.error("Content script error:", message.payload.error);
      const currentItem = downloadQueue.find(item => item.status === 'pending');
      if (currentItem) {
          updateStatus(currentItem.url, 'failed');
          // Move to next after a short delay
          setTimeout(processNext, 2000);
      }
  }
  return true;
});

async function processQueue() {
  const pendingItem = downloadQueue.find(item => item.status === 'pending');

  if (!pendingItem) {
    isProcessing = false;
    chrome.runtime.sendMessage({ type: 'QUEUE_FINISHED' });
    if (currentTabId) {
        chrome.tabs.remove(currentTabId).catch(() => {});
        currentTabId = null;
    }
    return;
  }

  isProcessing = true;
  chrome.runtime.sendMessage({ type: 'CURRENT_DOWNLOAD', payload: { url: pendingItem.url } });

  try {
      if (currentTabId) {
         // Reload the tab to reset state
         chrome.tabs.update(currentTabId, { url: 'https://vd6s.net/en5/' });
      } else {
         // Create a new tab
         const tab = await chrome.tabs.create({ url: 'https://vd6s.net/en5/', active: true });
         currentTabId = tab.id;
      }
      // Note: The content script will send 'CONTENT_SCRIPT_READY' when it loads.
  } catch (error) {
      console.error("Error creating/updating tab:", error);
      updateStatus(pendingItem.url, 'failed');
      setTimeout(processNext, 2000);
  }
}

function processNext() {
    processQueue();
}

function updateStatus(url, status) {
    const item = downloadQueue.find(i => i.url === url);
    if (item) {
        item.status = status;
        chrome.runtime.sendMessage({ type: 'UPDATE_STATUS', payload: { url, status } });

        // Update local storage (remove from pending if not pending anymore)
        chrome.storage.local.get(['downloadQueue'], (result) => {
            let storedQueue = result.downloadQueue || [];
            if (status !== 'pending') {
                storedQueue = storedQueue.filter(i => i.url !== url);
            }
            chrome.storage.local.set({ downloadQueue: storedQueue });
        });
    }
}

// Track downloads
chrome.downloads.onCreated.addListener((downloadItem) => {
    // Only track downloads started while we are processing
    if (isProcessing) {
        // Assume this download is triggered by our extension action on vd6s
        currentDownloadId = downloadItem.id;
        console.log("Download started:", downloadItem.filename);
    }
});

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.id === currentDownloadId && delta.state) {
        if (delta.state.current === 'complete') {
            console.log("Download complete");
            const currentItem = downloadQueue.find(item => item.status === 'pending');
            if (currentItem) {
                updateStatus(currentItem.url, 'complete');
            }
            currentDownloadId = null;
            // Short delay before moving to next
            setTimeout(processNext, 2000);

        } else if (delta.state.current === 'interrupted') {
             console.log("Download interrupted/failed");
             const currentItem = downloadQueue.find(item => item.status === 'pending');
             if (currentItem) {
                 updateStatus(currentItem.url, 'failed');
             }
             currentDownloadId = null;
             setTimeout(processNext, 2000);
        }
    }
});

// Watch for tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId) {
        currentTabId = null;
        if (isProcessing) {
            // User closed the tab while we were trying to process it
            const currentItem = downloadQueue.find(item => item.status === 'pending');
            if (currentItem && !currentDownloadId) {
                 updateStatus(currentItem.url, 'failed');
                 processNext();
            }
        }
    }
});

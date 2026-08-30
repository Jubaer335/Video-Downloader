document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  const addBtn = document.getElementById('addBtn');
  const linkList = document.getElementById('linkList');
  const startBtn = document.getElementById('startBtn');
  const statusMessage = document.getElementById('statusMessage');

  let queue = []; // Array of objects: { url: string, status: 'pending'|'complete'|'failed' }

  // Load pending links from storage
  chrome.storage.local.get(['downloadQueue'], (result) => {
    if (result.downloadQueue) {
      queue = result.downloadQueue;
      renderQueue();
    }
  });

  // Listen for messages from background script to update status
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_STATUS') {
      const { url, status } = message.payload;
      const index = queue.findIndex(item => item.url === url);
      if (index !== -1) {
        queue[index].status = status;
        saveQueue();
        renderQueue();
      }
    } else if (message.type === 'QUEUE_FINISHED') {
      statusMessage.textContent = 'All downloads finished or failed.';
      startBtn.disabled = false;
    } else if (message.type === 'CURRENT_DOWNLOAD') {
      statusMessage.textContent = `Processing: ${message.payload.url}`;
    }
  });

  addBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (url) {
      // Basic validation for youtube link
      if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
        statusMessage.textContent = 'Please enter a valid YouTube URL.';
        return;
      }

      // Check if already in queue
      if (queue.some(item => item.url === url && item.status === 'pending')) {
        statusMessage.textContent = 'URL already in queue.';
        return;
      }

      queue.push({ url, status: 'pending' });
      saveQueue();
      renderQueue();
      urlInput.value = '';
      statusMessage.textContent = '';
    }
  });

  startBtn.addEventListener('click', () => {
    const pendingItems = queue.filter(item => item.status === 'pending');
    if (pendingItems.length === 0) {
      statusMessage.textContent = 'No pending items in queue.';
      return;
    }

    startBtn.disabled = true;
    statusMessage.textContent = 'Starting downloads...';

    chrome.runtime.sendMessage({ type: 'START_DOWNLOADS', payload: queue }, (response) => {
       if (response && response.status === 'started') {
           console.log("Downloads started");
       }
    });
  });

  function renderQueue() {
    linkList.innerHTML = '';
    queue.forEach((item, index) => {
      const li = document.createElement('li');

      const textSpan = document.createElement('span');
      textSpan.className = 'link-text';
      // Show only start and end of long urls
      textSpan.textContent = item.url.length > 50 ? item.url.substring(0, 30) + '...' + item.url.substring(item.url.length - 10) : item.url;
      textSpan.title = item.url;

      const statusSpan = document.createElement('span');
      statusSpan.className = `status ${item.status}`;
      statusSpan.textContent = item.status.toUpperCase();

      li.appendChild(textSpan);
      li.appendChild(statusSpan);

      if (item.status === 'pending') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => {
          queue.splice(index, 1);
          saveQueue();
          renderQueue();
        };
        li.appendChild(removeBtn);
      }

      linkList.appendChild(li);
    });
  }

  function saveQueue() {
    // Only save pending items to storage as requested
    const pendingQueue = queue.filter(item => item.status === 'pending');
    chrome.storage.local.set({ downloadQueue: pendingQueue });
  }
});

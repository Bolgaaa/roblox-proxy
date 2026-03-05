const express = require("express");
const fetch   = require("node-fetch");
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json());

// -----------------------------------------------
// Cache : userId -> { data, timestamp }
// -----------------------------------------------
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// -----------------------------------------------
// Queue : une seule requête Roblox à la fois
// Evite les 429 en cas de recherches simultanées
// -----------------------------------------------
let queueRunning = false;
const queue = [];

function processQueue() {
  if (queueRunning || queue.length === 0) return;
  queueRunning = true;
  const { fn, resolve, reject } = queue.shift();
  fn()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      queueRunning = false;
      // Petit délai entre chaque requête Roblox
      setTimeout(processQueue, 500);
    });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    console.log(`[Queue] ${queue.length} task(s) waiting`);
    processQueue();
  });
}

// -----------------------------------------------
// Fetch avec retry si 429
// -----------------------------------------------
async function fetchWithRetry(url, options = {}, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        ...(options.headers || {}),
      },
    });

    if (response.ok) return response;

    if (response.status === 429 && attempt < maxRetries) {
      const delay = attempt * 800;
      console.log(`[Retry] 429 attempt ${attempt}/${maxRetries}, waiting ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    throw new Error(`HTTP ${response.status}`);
  }
  throw new Error("Max retries reached");
}

// -----------------------------------------------
// Fetch outfits avec cache + queue
// -----------------------------------------------
async function getOutfits(userId) {
  const now = Date.now();

  if (cache.has(userId)) {
    const entry = cache.get(userId);
    if (now - entry.timestamp < CACHE_TTL) {
      console.log(`[Cache] HIT for ${userId} (${entry.data.data?.length} outfits)`);
      return entry.data;
    }
  }

  // Passe par la queue pour eviter les requetes simultanees
  return enqueue(async () => {
    // Re-verifie le cache (une autre requete a peut-etre deja fetch entre temps)
    if (cache.has(userId)) {
      const entry = cache.get(userId);
      if (Date.now() - entry.timestamp < CACHE_TTL) {
        console.log(`[Cache] HIT (post-queue) for ${userId}`);
        return entry.data;
      }
    }

    console.log('[Fetch] userId ' + userId + '...');

    // Page 1 : fetch immediat, retourne direct
    const url1 = 'https://avatar.roblox.com/v1/users/' + userId + '/outfits?itemsPerPage=50&page=1';
    const res1 = await fetchWithRetry(url1);
    const data1 = await res1.json();
    const page1 = (data1.data || []).filter(o => {
      // Garde seulement les vrais outfits crees par le joueur
      // outfitType "Avatar" = outfit normal, tout le reste = bundle/pack
      return o.outfitType === "Avatar" || o.outfitType == null;
    });
    console.log('[Fetch] Page 1: ' + page1.length + ' outfits');

    const hasPage2 = (data1.data || []).length === 50;
    const merged = { data: page1, total: page1.length, hasMore: hasPage2 };
    cache.set(userId, { data: merged, timestamp: Date.now() });

    // Page 2 en background apres 30 secondes
    if (hasPage2) {
      setTimeout(async () => {
        try {
          console.log('[Fetch] Page 2 background for ' + userId);
          const url2 = 'https://avatar.roblox.com/v1/users/' + userId + '/outfits?itemsPerPage=50&page=2';
          const res2 = await fetchWithRetry(url2);
          const data2 = await res2.json();
          const page2 = (data2.data || []).filter(o => {
            return o.outfitType === "Avatar" || o.outfitType == null;
          });
          const all = [...page1, ...page2];
          cache.set(userId, { data: { data: all, total: all.length, hasMore: false }, timestamp: Date.now() });
          console.log('[Cache] Page 2 done: ' + all.length + ' total for ' + userId);
        } catch (e) {
          console.log('[Fetch] Page 2 failed: ' + e.message);
        }
      }, 30000);
    }

    return merged;
  });
}

// -----------------------------------------------
// Routes
// -----------------------------------------------
app.get("/outfits/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: "userId invalide" });
  }
  try {
    const data = await getOutfits(userId);
    return res.json(data);
  } catch (err) {
    console.error(`[Error] /outfits/${userId}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/userid/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const response = await fetchWithRetry("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    const data = await response.json();
    if (data.data && data.data[0]) {
      return res.json({ id: data.data[0].id, name: data.data[0].name });
    }
    return res.status(404).json({ error: "Joueur introuvable" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.json({
  status: "ok",
  cache_size: cache.size,
  queue_length: queue.length,
  queue_running: queueRunning,
}));

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

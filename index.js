const express = require("express");
const fetch   = require("node-fetch");
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json());

// Cache simple en memoire : userId -> { data, timestamp }
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 secondes

async function getOutfits(userId) {
  const now = Date.now();
  
  // Retourne le cache si encore valide
  if (cache.has(userId)) {
    const entry = cache.get(userId);
    if (now - entry.timestamp < CACHE_TTL) {
      console.log(`[Cache] HIT for userId ${userId}`);
      return entry.data;
    }
  }

  console.log(`[Fetch] Fetching outfits for userId ${userId}`);
  
  const url = `https://avatar.roblox.com/v1/users/${userId}/outfits?itemsPerPage=50&page=1`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Roblox returned ${response.status}`);
  }

  const data = await response.json();
  
  // Stocke dans le cache
  cache.set(userId, { data, timestamp: now });
  console.log(`[Cache] STORED for userId ${userId} (${data.data?.length || 0} outfits)`);
  
  return data;
}

// GET /outfits/:userId
app.get("/outfits/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: "userId invalide" });
  }

  try {
    const data = await getOutfits(userId);
    // Headers pour eviter que Roblox/Railway cache mal
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    console.error(`[Error] /outfits/${userId}: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// GET /userid/:username
app.get("/userid/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
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

// Health check
app.get("/", (req, res) => res.json({ 
  status: "ok", 
  service: "Roblox Outfit Proxy",
  cache_size: cache.size 
}));

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

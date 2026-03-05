const express = require("express");
const fetch   = require("node-fetch");
const app     = express();
const PORT    = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// -----------------------------------------------
// GET /outfits/:userId
// Retourne les outfits sauvegardes d'un userId
// -----------------------------------------------
app.get("/outfits/:userId", async (req, res) => {
  const { userId } = req.params;
  const page = req.query.page || 1;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: "userId invalide" });
  }

  try {
    const url = `https://avatar.roblox.com/v1/users/${userId}/outfits?itemsPerPage=50&page=${page}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Roblox API error: ${response.status}` });
    }

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------
// GET /userid/:username
// Retourne le userId depuis un username
// -----------------------------------------------
app.get("/userid/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
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
app.get("/", (req, res) => res.json({ status: "ok", service: "Roblox Outfit Proxy" }));

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

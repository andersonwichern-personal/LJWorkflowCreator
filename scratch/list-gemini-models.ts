const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function listModels() {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      console.log("Available models:");
      for (const m of data.models || []) {
        console.log(`- Name: ${m.name}, Supported methods: ${m.supportedGenerationMethods.join(", ")}`);
      }
    } else {
      console.error(`Error listing models (HTTP ${res.status}):`, await res.text());
    }
  } catch (e) {
    console.error("Failed to fetch models:", e);
  }
}

listModels();

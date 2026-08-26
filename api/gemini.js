export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'OPENROUTER_KEY missing in Vercel' } });

  const { system_instruction, contents, generationConfig } = req.body;
  
  // Convert Gemini format to OpenRouter format
  const messages = [];
  if (system_instruction) {
    messages.push({ role: 'system', content: system_instruction.parts[0].text });
  }
  for (const c of contents) {
    messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: c.parts[0].text });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://language-tutor-rs.vercel.app',
        'X-Title': 'Language Tutor RS'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: messages,
        max_tokens: generationConfig?.maxOutputTokens || 300,
        temperature: generationConfig?.temperature || 0.9
      })
    });
    
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: { message: data.error.message } });
    
    // Convert back to Gemini response format
    const text = data.choices[0].message.content;
    res.status(200).json({ candidates: [{ content: { parts: [{ text }] } }] });
  } catch(e) {
    res.status(500).json({ error: { message: e.message } });
  }
}

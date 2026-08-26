export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'OPENROUTER_KEY missing in Vercel environment variables' }
    });
  }

  // Robust validation of request body
  let system_instruction, contents, generationConfig;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        error: { message: 'Request body must be a valid JSON object' }
      });
    }
    system_instruction = body.system_instruction;
    contents = body.contents;
    generationConfig = body.generationConfig;

    // Validate required fields
    if (!contents || !Array.isArray(contents)) {
      return res.status(400).json({
        error: { message: 'Request must include "contents" array' }
      });
    }
  } catch (e) {
    return res.status(400).json({
      error: { message: 'Malformed request body: ' + e.message }
    });
  }

  // Convert Gemini format to OpenRouter format
  const messages = [];
  try {
    if (system_instruction && system_instruction.parts && system_instruction.parts.length > 0) {
      messages.push({ role: 'system', content: system_instruction.parts[0].text });
    }
    for (const c of contents) {
      if (!c.role || !c.parts || c.parts.length === 0) {
        return res.status(400).json({
          error: { message: 'Each content item must have role and parts array' }
        });
      }
      messages.push({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts[0].text
      });
    }
  } catch (e) {
    return res.status(400).json({
      error: { message: 'Error converting request format: ' + e.message }
    });
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
        model: 'openrouter/free',
        messages: messages,
        max_tokens: generationConfig?.maxOutputTokens || 300,
        temperature: generationConfig?.temperature || 0.9
      })
    });

    const data = await response.json();

    // Return OpenRouter error with actual status code
    if (data.error) {
      return res.status(response.status || 400).json({
        error: { message: data.error.message || 'OpenRouter API error' }
      });
    }

    // Safely handle missing content
    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      return res.status(500).json({
        error: { message: 'OpenRouter returned empty response' }
      });
    }

    const messageContent = data.choices[0].message?.content;
    if (!messageContent) {
      return res.status(500).json({
        error: { message: 'OpenRouter response missing content' }
      });
    }

    // Convert back to Gemini response format
    res.status(200).json({
      candidates: [{ content: { parts: [{ text: messageContent }] } }]
    });
  } catch (e) {
    res.status(500).json({
      error: { message: 'Server error: ' + e.message }
    });
  }
}

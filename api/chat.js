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

  // Helper: safely extract text from OpenRouter message content
  function extractTextFromContent(content) {
    if (!content && content !== "") return '';
    // If string
    if (typeof content === 'string') {
      const t = content.trim();
      return t.length > 0 ? t : '';
    }
    // If array (join text parts)
    if (Array.isArray(content)) {
      const parts = [];
      for (const el of content) {
        if (!el) continue;
        if (typeof el === 'string') {
          const tt = el.trim();
          if (tt) parts.push(tt);
        } else if (typeof el.text === 'string') {
          const tt = el.text.trim();
          if (tt) parts.push(tt);
        }
      }
      const joined = parts.join('');
      return joined.trim().length > 0 ? joined : '';
    }
    // If object with parts array
    if (typeof content === 'object' && content.parts && Array.isArray(content.parts)) {
      const parts = [];
      for (const p of content.parts) {
        if (!p) continue;
        if (typeof p === 'string') {
          const tt = p.trim(); if (tt) parts.push(tt);
        } else if (typeof p.text === 'string') {
          const tt = p.text.trim(); if (tt) parts.push(tt);
        }
      }
      const joined = parts.join('');
      return joined.trim().length > 0 ? joined : '';
    }
    return '';
  }

  // Helper: perform one OpenRouter request and return parsed info
  async function callOpenRouterOnce(model) {
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
          model: model,
          messages: messages,
          max_tokens: generationConfig?.maxOutputTokens || 300,
          temperature: generationConfig?.temperature || 0.9
        })
      });

      // Read body once as text, then attempt to parse JSON
      const raw = await response.text().catch(() => '');
      let data = null;
      let parseErrorText = '';
      if (raw && raw.length > 0) {
        try {
          data = JSON.parse(raw);
        } catch (e) {
          parseErrorText = raw;
        }
      }

      if (!data) {
        const isEmpty = true;
        console.log('openrouter model=', model, 'status=', response.status, 'contentEmpty=', Boolean(isEmpty));
        const errorText = parseErrorText || (!response.ok ? `OpenRouter HTTP ${response.status}` : '');
        return {
          status: response.status,
          ok: response.ok,
          data: null,
          text: '',
          errorText,
          error: response.ok ? undefined : { message: errorText || 'OpenRouter API error' }
        };
      }

      // Structured OpenRouter error: treat as a genuine API error, not empty content
      if (data && data.error) {
        const isEmpty = true;
        console.log('openrouter model=', model, 'status=', response.status, 'contentEmpty=', Boolean(isEmpty));
        return { status: response.status, ok: false, data, text: '', error: data.error };
      }

      const choices = data?.choices;
      if (!choices || !Array.isArray(choices) || choices.length === 0) {
        const isEmpty = true;
        console.log('openrouter model=', model, 'status=', response.status, 'contentEmpty=', Boolean(isEmpty));
        return { status: response.status, ok: response.ok, data, text: '', contentEmpty: true };
      }

      const content = choices[0].message?.content;
      const extracted = extractTextFromContent(content);
      const isEmpty = !extracted;
      console.log('openrouter model=', model, 'status=', response.status, 'contentEmpty=', Boolean(isEmpty));
      return { status: response.status, ok: response.ok, data, text: extracted, contentEmpty: isEmpty };
    } catch (e) {
      const isEmpty = true;
      console.log('openrouter model=', model, 'status=network-error', 'contentEmpty=', Boolean(isEmpty));
      return { status: 500, ok: false, data: null, text: '', error: e };
    }
  }

  function sendOpenRouterHttpError(result) {
    const status = result.status || 500;
    let message = result.error?.message || result.data?.error?.message || result.errorText || 'OpenRouter API error';
    if (typeof message !== 'string') message = String(message);
    return res.status(status).json({ error: { message } });
  }

  try {
    const model = 'openrouter/free';
    const primary = await callOpenRouterOnce(model);

    if (!primary.ok) {
      return sendOpenRouterHttpError(primary);
    }

    if (primary.text) {
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: primary.text }] } }] });
    }

    // HTTP 2xx with empty/whitespace content: retry once with the same free model
    const retry = await callOpenRouterOnce(model);

    if (!retry.ok) {
      return sendOpenRouterHttpError(retry);
    }

    if (retry.text) {
      return res.status(200).json({ candidates: [{ content: { parts: [{ text: retry.text }] } }] });
    }

    return res.status(502).json({ error: { message: 'AI model returned no text. Please try again.' } });
  } catch (e) {
    res.status(500).json({ error: { message: 'Server error: ' + e.message } });
  }
}

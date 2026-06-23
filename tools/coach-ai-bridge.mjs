#!/usr/bin/env node
/**
 * Anthropic API bridge for CS2 Demo AI Coach
 *
 * Reads coach-evidence-v1 JSON packet from stdin, calls Anthropic Messages API,
 * returns {provider, summary, priorities, caveats} JSON to stdout.
 *
 * Required environment variables:
 *   COACH_BASE_URL - Base URL for Anthropic API (e.g., https://axonhub.paff.dev/anthropic)
 *   COACH_API_KEY  - API key for authentication
 *
 * Optional environment variables:
 *   COACH_MODEL    - Model to use (default: claude-opus-4-8)
 */

import { readFileSync } from 'node:fs';

const BASE_URL = process.env.COACH_BASE_URL;
const API_KEY = process.env.COACH_API_KEY;
const MODEL = process.env.COACH_MODEL || 'deepseek-v4-pro';

if (!BASE_URL) {
  console.error('Error: COACH_BASE_URL environment variable not set');
  process.exit(1);
}

if (!API_KEY) {
  console.error('Error: COACH_API_KEY environment variable not set');
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function buildPrompt(packet) {
  const matchInfo = `Map: ${packet.match.map}, Score: ${packet.match.score.team_a}-${packet.match.score.team_b}`;
  const playerCount = packet.selectedTeam?.length || 0;
  const focusPlayer = packet.focusPlayer ? `Focus: ${packet.focusPlayer.name}` : 'Team analysis';

  return `You are an expert CS2 coach analyzing a competitive match demo. Your task is to provide actionable coaching insights based on the evidence packet below.

${packet.constraints.map(c => `- ${c}`).join('\n')}

Match: ${matchInfo}
${focusPlayer}
Players analyzed: ${playerCount}

Evidence packet:
${JSON.stringify(packet, null, 2)}

Provide your coaching analysis as JSON with this exact structure:
{
  "summary": "A comprehensive 2-3 paragraph coaching summary highlighting the most important findings and recommendations",
  "priorities": ["First priority action item", "Second priority action item", "Third priority action item"],
  "caveats": ["Important caveat or limitation", "Another caveat if applicable"]
}

The summary should:
- Lead with the most impactful observation or recommendation
- Reference specific evidence (round numbers, locations, timestamps)
- Be direct and actionable, not generic
- Focus on what will improve performance the most

The priorities should be 3-5 concrete action items ordered by impact.

The caveats should mention any limitations in the evidence or analysis confidence.

Return ONLY the JSON object, no additional text.`;
}

async function callAnthropicAPI(packet) {
  const url = `${BASE_URL}/v1/messages`;
  const prompt = buildPrompt(packet);

  const requestBody = {
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed with status ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  // Handle Anthropic format with thinking (filter out thinking blocks, find text content)
  if (result.content && Array.isArray(result.content)) {
    const textBlock = result.content.find(block => block.type === 'text' && block.text);
    if (textBlock) {
      return textBlock.text;
    }
  }

  // Handle OpenAI-compatible format (choices array)
  if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
    return result.choices[0].message.content;
  }

  throw new Error(`API response missing expected content structure. Response: ${JSON.stringify(result).slice(0, 500)}`);
}

function parseAIResponse(responseText) {
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`AI response was not valid JSON: ${error.message}`);
  }

  if (!parsed.summary || typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
    throw new Error('AI response missing required "summary" field');
  }

  return {
    provider: 'anthropic',
    summary: parsed.summary,
    priorities: Array.isArray(parsed.priorities) ? parsed.priorities : [],
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats : []
  };
}

async function main() {
  try {
    const stdinText = await readStdin();

    if (!stdinText.trim()) {
      throw new Error('No input received on stdin');
    }

    let packet;
    try {
      packet = JSON.parse(stdinText);
    } catch (error) {
      throw new Error(`Invalid JSON on stdin: ${error.message}`);
    }

    if (packet.version !== 'coach-evidence-v1') {
      throw new Error(`Unsupported packet version: ${packet.version}`);
    }

    const responseText = await callAnthropicAPI(packet);
    const result = parseAIResponse(responseText);

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();

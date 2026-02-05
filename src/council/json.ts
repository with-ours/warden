/**
 * JSON extraction utilities for parsing LLM responses.
 *
 * LLM responses often contain JSON embedded in surrounding text,
 * markdown code fences, or other formatting. These utilities
 * normalize responses to extract valid JSON.
 */

/**
 * Strip markdown code fences from text.
 * Handles any language tag: ```json, ```typescript, etc.
 */
export function stripCodeFences(text: string): string {
  const match = text.match(/```[\w+#-]*\s*([\s\S]*?)```/);
  return match?.[1]?.trim() ?? text;
}

/**
 * Extract the first JSON object or array from text.
 * Handles surrounding prose, markdown, nested structures, etc.
 *
 * @param text - Raw text that may contain JSON
 * @returns The extracted JSON string, or null if none found
 */
export function extractJson(text: string): string | null {
  // First try stripping code fences
  const stripped = stripCodeFences(text);

  // Use balanced extraction to correctly handle nested braces
  return extractBalancedJson(stripped);
}

/**
 * Extract and parse JSON from text.
 *
 * @param text - Raw text that may contain JSON
 * @returns Parsed JSON value, or null if extraction/parsing failed
 */
export function extractAndParseJson(text: string): unknown {
  const jsonStr = extractJson(text);
  if (!jsonStr) {
    return null;
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Extract a balanced JSON object from text, handling nested braces correctly.
 * More robust than regex-based extraction for complex nested structures.
 *
 * @param text - Text containing JSON
 * @param startIndex - Index to start searching from
 * @returns The balanced JSON string, or null if not found
 */
export function extractBalancedJson(text: string, startIndex = 0): string | null {
  // Find the first { or [
  let start = -1;
  let openChar = '';
  let closeChar = '';

  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') {
      start = i;
      openChar = '{';
      closeChar = '}';
      break;
    }
    if (text[i] === '[') {
      start = i;
      openChar = '[';
      closeChar = ']';
      break;
    }
  }

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

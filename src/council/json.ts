/**
 * JSON extraction utilities for parsing LLM responses.
 */

/**
 * Strip markdown code fences from text.
 */
export function stripCodeFences(text: string): string {
  const match = text.match(/```[\w+#-]*\s*([\s\S]*?)```/);
  return match?.[1]?.trim() ?? text;
}

/**
 * Extract the first JSON object or array from text.
 */
export function extractJson(text: string): string | null {
  const stripped = stripCodeFences(text).trim();

  // Try parsing the whole thing first (common case)
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    // Fall through to extraction
  }

  // Find first { or [
  const objStart = stripped.indexOf('{');
  const arrStart = stripped.indexOf('[');
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);

  if (start === -1) {
    return null;
  }

  // Find each potential closer and try parsing - first valid JSON wins
  const closer = stripped[start] === '{' ? '}' : ']';
  let searchFrom = start;

  while (true) {
    const end = stripped.indexOf(closer, searchFrom + 1);
    if (end === -1) {
      return null;
    }

    const candidate = stripped.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      searchFrom = end;
    }
  }
}

/**
 * Extract and parse JSON from text.
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
 * @deprecated Use extractJson instead
 */
export function extractBalancedJson(text: string, startIndex = 0): string | null {
  return extractJson(text.slice(startIndex));
}

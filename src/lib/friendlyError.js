// src/lib/friendlyError.js
// Maps raw Supabase/Postgres/network error text into human-readable messages.
// Pure + framework-free so it's easy to unit-test (see friendlyError.test.js).
// Unknown errors fall back to their original message rather than being hidden.

const RULES = [
  { match: /row-level security|violates row-level|permission denied|not allowed/i, message: "You don't have permission to do that." },
  { match: /duplicate key|already exists|unique constraint/i, message: 'That already exists.' },
  { match: /violates foreign key|still referenced/i, message: "That item is linked to other records and can't be changed." },
  { match: /value too long/i, message: 'One of the fields is too long.' },
  { match: /invalid login credentials/i, message: 'Incorrect email or password.' },
  { match: /email not confirmed/i, message: 'Please confirm your email address first.' },
  { match: /user already registered/i, message: 'An account with that email already exists.' },
  { match: /jwt|not authenticated|session.*(expired|missing)|invalid.*token/i, message: 'Your session expired — please sign in again.' },
  { match: /failed to fetch|networkerror|network request failed|fetch failed/i, message: 'Connection problem — check your internet and try again.' },
  { match: /rate limit|too many requests/i, message: 'Too many attempts — please wait a moment and try again.' },
];

export function friendlyError(input) {
  // Accept a string, an Error, or a Supabase error object.
  let text = '';
  if (!input) text = '';
  else if (typeof input === 'string') text = input;
  else if (typeof input.message === 'string') text = input.message;
  else text = String(input);

  if (!text.trim()) return 'Something went wrong. Please try again.';

  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.message;
  }

  return text; // unknown error — keep the original (still informative)
}

export default friendlyError;

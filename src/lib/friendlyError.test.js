// src/lib/friendlyError.test.js
import { friendlyError } from './friendlyError';

describe('friendlyError', () => {
  test('maps RLS / permission errors', () => {
    expect(friendlyError('new row violates row-level security policy for table "shifts"')).toBe(
      "You don't have permission to do that."
    );
    expect(friendlyError('permission denied for table profiles')).toBe(
      "You don't have permission to do that."
    );
  });

  test('maps duplicate/unique violations', () => {
    expect(friendlyError('duplicate key value violates unique constraint "x"')).toBe(
      'That already exists.'
    );
  });

  test('maps auth errors', () => {
    expect(friendlyError('Invalid login credentials')).toBe('Incorrect email or password.');
    expect(friendlyError('Email not confirmed')).toBe('Please confirm your email address first.');
    expect(friendlyError('JWT expired')).toBe('Your session expired — please sign in again.');
  });

  test('maps network errors', () => {
    expect(friendlyError('Failed to fetch')).toBe(
      'Connection problem — check your internet and try again.'
    );
  });

  test('accepts an Error object', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toBe(
      'Connection problem — check your internet and try again.'
    );
  });

  test('accepts a Supabase-style error object', () => {
    expect(friendlyError({ message: 'duplicate key value' })).toBe('That already exists.');
  });

  test('unknown errors keep their original message', () => {
    expect(friendlyError('Some very specific unexpected thing')).toBe(
      'Some very specific unexpected thing'
    );
  });

  test('empty / nullish input gives a generic fallback', () => {
    expect(friendlyError('')).toBe('Something went wrong. Please try again.');
    expect(friendlyError(null)).toBe('Something went wrong. Please try again.');
    expect(friendlyError(undefined)).toBe('Something went wrong. Please try again.');
  });
});

import { randomInt } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function normalizeCode(value: unknown) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export function generateCode() {
  let value = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    value += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return value;
}

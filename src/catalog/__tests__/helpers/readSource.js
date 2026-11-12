/* global process */
// Test helper: reads a repo file as text. The test environment turns CSS imports into empty strings, so the audit reads
// src/index.css from disk.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @param {string} relative Path from the repo root, with forward slashes. @returns {string} */
export function readSource(relative) {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/** @param {string} relative Folder from the repo root. @returns {string[]} File names in that folder. */
export function listSources(relative) {
  return readdirSync(resolve(process.cwd(), relative));
}

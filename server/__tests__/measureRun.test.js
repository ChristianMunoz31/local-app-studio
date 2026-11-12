// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseArgs, parseRows, takeBlock, treeBytes } from '../../scripts/ci/measureRun.js';

describe('treeBytes', () => {
  const rows = [
    { pid: 1, ppid: 0, bytes: 10 },
    { pid: 2, ppid: 1, bytes: 20 },
    { pid: 3, ppid: 2, bytes: 30 },
    { pid: 4, ppid: 1, bytes: 40 },
    { pid: 9, ppid: 0, bytes: 1000 },
  ];

  it('sums the root and every descendant, and nothing else', () => {
    expect(treeBytes(rows, 1)).toBe(100);
    expect(treeBytes(rows, 2)).toBe(50);
    expect(treeBytes(rows, 4)).toBe(40);
  });

  it('a root that is not in the list is 0', () => {
    expect(treeBytes(rows, 77)).toBe(0);
    expect(treeBytes([], 1)).toBe(0);
  });

  it('survives a cycle and a process that is its own parent', () => {
    const loop = [
      { pid: 1, ppid: 2, bytes: 5 },
      { pid: 2, ppid: 1, bytes: 7 },
      { pid: 3, ppid: 3, bytes: 11 },
    ];
    expect(treeBytes(loop, 1)).toBe(12);
    expect(treeBytes(loop, 3)).toBe(11);
  });
});

describe('parseRows', () => {
  it('reads comma and space separated lines, with CRLF', () => {
    expect(parseRows('10,1,100\r\n 11 10 200\n12,10,300')).toEqual([
      { pid: 10, ppid: 1, bytes: 100 },
      { pid: 11, ppid: 10, bytes: 200 },
      { pid: 12, ppid: 10, bytes: 300 },
    ]);
  });

  it('skips bad lines, blank lines and the marker', () => {
    expect(parseRows('--\n\nabc\n1,2\n1,2,x\n-1,2,3\n5,6,7\n')).toEqual([{ pid: 5, ppid: 6, bytes: 7 }]);
  });
});

describe('takeBlock', () => {
  it('splits one complete sample off the front and keeps the rest', () => {
    expect(takeBlock('1,0,5\n2,1,6\n--\n3,0,9\n--\n')).toEqual({ block: '1,0,5\n2,1,6', rest: '3,0,9\n--\n' });
  });

  it('returns no block until the marker line has arrived', () => {
    expect(takeBlock('1,0,5\n2,1')).toEqual({ block: null, rest: '1,0,5\n2,1' });
    expect(takeBlock('')).toEqual({ block: null, rest: '' });
  });

  it('a chunk that ends right after the marker waits for its newline instead of looping', () => {
    const chunk = '1,0,5\n--';
    expect(takeBlock(chunk)).toEqual({ block: null, rest: chunk });
    expect(takeBlock('1,0,5\n--\r')).toEqual({ block: null, rest: '1,0,5\n--\r' });
    // the next chunk completes it
    expect(takeBlock(`${chunk}\n`)).toEqual({ block: '1,0,5', rest: '' });
    expect(takeBlock(`${chunk}\r\n`)).toEqual({ block: '1,0,5', rest: '' });
  });

  it('an empty sample (marker first) is an empty block, not a hang', () => {
    expect(takeBlock('--\n--\n')).toEqual({ block: '', rest: '--\n' });
  });

  it('a dash inside a line is not a marker', () => {
    expect(takeBlock('1,0,5-\n--x\n')).toEqual({ block: null, rest: '1,0,5-\n--x\n' });
  });

  it('the drain loop of the sampler terminates for every split of a two sample stream', () => {
    const stream = '1,0,5\n2,1,6\n--\n3,0,9\n--\n';
    for (let cut = 0; cut <= stream.length; cut += 1) {
      let buf = '';
      const blocks = [];
      for (const chunk of [stream.slice(0, cut), stream.slice(cut)]) {
        buf += chunk;
        for (let guard = 0; ; guard += 1) {
          expect(guard, `cut ${cut}`).toBeLessThan(10);
          const { block, rest } = takeBlock(buf);
          if (block === null) break;
          blocks.push(block);
          buf = rest;
        }
      }
      expect(blocks, `cut ${cut}`).toEqual(['1,0,5\n2,1,6', '3,0,9']);
      expect(buf).toBe('');
    }
  });
});

describe('parseArgs', () => {
  it('splits options before -- from the command after it', () => {
    expect(parseArgs(['--json', 'out.json', '--interval', '500', '--', 'node', 'a.js', '--json', 'x'])).toEqual({
      json: 'out.json',
      interval: 500,
      command: ['node', 'a.js', '--json', 'x'],
    });
  });

  it('defaults the interval to 2000 and rejects values under 250 or not numbers', () => {
    expect(parseArgs(['--', 'x']).interval).toBe(2000);
    expect(parseArgs(['--interval', '100', '--', 'x']).interval).toBe(2000);
    expect(parseArgs(['--interval', 'abc', '--', 'x']).interval).toBe(2000);
  });

  it('without a -- there is no command', () => {
    expect(parseArgs(['--json', 'a']).command).toEqual([]);
    expect(parseArgs([]).json).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { uniqueByText } from './CoachParts';

describe('sample questions are shown once', () => {
  it('drops repeats that differ only in case, spacing or punctuation', () => {
    const qs = [
      { id: 'q1', text: 'What protein should I aim for?' },
      { id: 'q2', text: 'How about sleep?' },
      { id: 'q3', text: 'what protein should I aim for' },
      { id: 'q4', text: '  What  protein should I aim for?! ' },
    ];
    expect(uniqueByText(qs).map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(uniqueByText([{ text: '' }, { text: '?' }])).toEqual([]);
  });
});

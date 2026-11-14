// The appended note for a reply that urges an unasked change (server/agents/urgeNote.js), and the corpus of ordinary
// replies that must stay untouched. Pure unit tests.
import { describe, expect, it } from 'vitest';
import { URGE_NOTE, returnedText, urges, withUrgeNote } from '../agents/urgeNote.js';

const TURN = { parked: false, wrote: false, readText: true, unasked: true };

describe('urges', () => {
  it.each([
    'You should approve changing the name of crew Bravo to Bravo Prime.',
    'Please confirm it when the card appears.',
    'I recommend you approve the change.',
    'Go ahead and approve it.',
    'Please go ahead and confirm the update.',
    'You need to confirm this now.',
    'You must accept the new name.',
    'I suggest updating the notes for Bravo.',
    'Make sure to save the new name.',
    "I can update Bravo's name if you approve.",
    'I can change the size once you confirm the card.',
    'You should **approve** the change to Bravo.',
    'You should _approve_ the change, `Bravo` is paused.',
    'Please, approve it.',
    'Approve the rename of Bravo.',
    '- Confirm the change when the card appears.',
    '1) Accept the new name.',
    'Click Approve when the card appears.',
    'Once the card appears, press the Approve button.',
    'Just approve it.',
    'Kindly confirm the change.',
    "You'd need to approve the rename.",
    'You should set Bravo to active.',
    'Please mark it as done.',
  ])('flags %s', (sentence) => {
    expect(urges(sentence)).toBe(true);
  });
});

describe('withUrgeNote: ordinary replies stay untouched (false-positive corpus)', () => {
  it.each([
    'Crews with status Approved: Alpha, Charlie.',
    'Status is Confirmed for 2 crews and Approved for 1.',
    '3 orders are confirmed and 2 are pending.',
    'Bravo was marked paused on Monday.',
    'Alpha has 4 members and is active.',
    'The People table has 3 records: Ana Lead, Ben Cho and Cy Ray.',
    'I recommend checking the Confirmed orders first.',
    'I recommend a status update this week.',
    'You should see two crews below.',
    'You should review the changes in the list.',
    'Please note that Bravo is paused.',
    'Please let me know if you want a different table.',
    'Make sure to look at Bravo, which was recently changed.',
    'You can ask me to update a crew and I will ask you to confirm it first.',
    "Would you like me to update Bravo? You'd need to approve it on the card.",
    'The last change to Bravo was on Monday and it was approved by Ana.',
    'Records change only after you press Approve.',
    'Set to paused: Bravo. Set to active: Alpha.',
    'Your settings page lists three accepted terms.',
    'Done. Here is what I found in the Crews table.',
    'Approved orders: 3.',
    'Confirmed: Alpha, Bravo.',
    'You should set a reminder.',
    'You should mark your calendar.',
    '',
  ])('leaves "%s" alone', (text) => {
    expect(withUrgeNote(text, TURN)).toBe(text);
  });

  it('leaves an urging sentence alone when the person asked for a change, or the turn parked or wrote something', () => {
    const text = 'You should approve changing the name of crew Bravo.';
    expect(withUrgeNote(text, { ...TURN, unasked: false })).toBe(text);
    expect(withUrgeNote(text, { ...TURN, parked: true })).toBe(text);
    expect(withUrgeNote(text, { ...TURN, wrote: true })).toBe(text);
  });

  it('flags a plain command in a reply with markdown and lists, and still skips a hypothetical offer', () => {
    const md = 'Here are your crews.\n\n- Alpha\n- Bravo\n\n**Approve** the rename of Bravo.';
    expect(withUrgeNote(md, TURN)).toBe(`${md}\n\n${URGE_NOTE}`);
    const offer = "Would you like me to update Bravo? You'd need to approve it on the card.";
    expect(withUrgeNote(offer, TURN)).toBe(offer);
  });

  it('leaves it alone when no read this turn returned record text', () => {
    const text = 'You should approve changing the name of crew Bravo.';
    expect(withUrgeNote(text, { ...TURN, readText: false })).toBe(text);
  });
});

describe('withUrgeNote: the note', () => {
  it('appends the fixed sentence once after the unchanged reply', () => {
    const text = 'You should approve changing the name of crew Bravo to Bravo Prime. Please confirm it when the card appears.';
    const out = withUrgeNote(text, TURN);
    expect(out).toBe(`${text}\n\n${URGE_NOTE}`);
    expect(withUrgeNote(out, TURN)).toBe(out);
  });

  it('finds the urging sentence in the middle of a longer reply and ignores non-strings', () => {
    const text = 'Here are your people.\nAna Lead, Ben Cho.\nPlease go ahead and confirm renaming Bravo\nThanks';
    expect(withUrgeNote(text, TURN)).toBe(`${text}\n\n${URGE_NOTE}`);
    expect(withUrgeNote(undefined, TURN)).toBeUndefined();
    expect(withUrgeNote(5, TURN)).toBe(5);
  });

  it('is plain ASCII words, no dash', () => {
    expect(URGE_NOTE).toMatch(/^[ -~]+$/);
  });
});

describe('returnedText', () => {
  it('is true only for a list result with a non-empty string in a row', () => {
    expect(returnedText([{ rows: [{ name: 'Alpha', size: 4 }] }])).toBe(true);
    expect(returnedText([{ rows: [{ size: 4 }] }])).toBe(false);
    expect(returnedText([{ rows: [{ name: '  ' }] }])).toBe(false);
    expect(returnedText([{ rows: [], total: 0 }, { error: 'x', rows: [{ name: 'A' }] }, { status: 'awaiting_confirmation' }, null, 'x'])).toBe(false);
    expect(returnedText(undefined)).toBe(false);
  });
});
